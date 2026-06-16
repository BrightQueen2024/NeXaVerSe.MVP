package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gobwas/ws"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"nexaverse/go-gateway/pkg/websocket"
)

func main() {
	var redisCli *redis.Client
	redisURL := os.Getenv("REDIS_URL")
	if redisURL != "" {
		opt, err := redis.ParseURL(redisURL)
		if err != nil {
			log.Printf("Warning: Failed to parse REDIS_URL: %v", err)
		} else {
			redisCli = redis.NewClient(opt)
			log.Printf("Connected to Redis via REDIS_URL")
		}
	}

	if redisCli == nil {
		redisAddr := os.Getenv("REDIS_ADDR")
		if redisAddr == "" {
			redisAddr = "localhost:6379"
		}
		redisCli = redis.NewClient(&redis.Options{
			Addr: redisAddr,
		})
		log.Printf("Connected to Redis via REDIS_ADDR at %s", redisAddr)
	}

	// Test Redis connection
	if err := redisCli.Ping(context.Background()).Err(); err != nil {
		log.Printf("Warning: Failed to connect to Redis: %v", err)
	} else {
		log.Printf("Redis connection verified successfully")
	}

	hub, err := websocket.NewHub(redisCli)
	if err != nil {
		log.Fatalf("Failed to initialize hub: %v", err)
	}

	// Start epoll/event loop in a separate goroutine
	go hub.StartEventLoop()

	// Register WebSocket presence route
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		// CORS headers for WS handshake / setup
		w.Header().Set("Access-Control-Allow-Origin", "*")
		
		token := r.URL.Query().Get("token")
		if token == "" {
			http.Error(w, "Authentication token required", http.StatusUnauthorized)
			return
		}
		userID, age, err := verifyToken(token)
		if err != nil {
			http.Error(w, "Invalid token: "+err.Error(), http.StatusUnauthorized)
			return
		}

		conn, _, _, err := ws.UpgradeHTTP(r, w)
		if err != nil {
			log.Printf("WebSocket upgrade error: %v", err)
			return
		}

		client := websocket.NewClient(uuid.New().String(), userID, age, conn)
		if err := hub.Register(client); err != nil {
			log.Printf("Failed to register client: %v", err)
			_ = conn.Close()
			return
		}

		log.Printf("User %s (Age: %d) connected successfully via WebSocket", userID, age)
	})

	// Configure reverse proxies for REST microservices
	ledgerURLStr := os.Getenv("LEDGER_SERVICE_URL")
	if ledgerURLStr == "" {
		ledgerURLStr = "http://localhost:8081"
	}
	mediaURLStr := os.Getenv("MEDIA_SERVICE_URL")
	if mediaURLStr == "" {
		mediaURLStr = "http://localhost:8082"
	}

	ledgerProxy := proxyHandler(ledgerURLStr)
	mediaProxy := proxyHandler(mediaURLStr)

	// Catch-all route to proxy REST API calls and serve health status
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Apply basic request method CORS handling
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Idempotency-Key, Authorization, X-Internal-Token, X-User-Id")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		path := r.URL.Path

		if path == "/auth/login" {
			if r.Method != http.MethodPost {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			type LoginReq struct {
				UserID string `json:"user_id"`
				Age    int    `json:"age"`
			}
			var reqData LoginReq
			if err := json.NewDecoder(r.Body).Decode(&reqData); err != nil {
				http.Error(w, "Bad request", http.StatusBadRequest)
				return
			}
			if reqData.UserID == "" {
				http.Error(w, "user_id is required", http.StatusBadRequest)
				return
			}
			token, err := createToken(reqData.UserID, reqData.Age)
			if err != nil {
				http.Error(w, "Internal server error", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]string{"token": token})
			return
		}

		isProxyRoute := strings.HasPrefix(path, "/wallet/") || strings.HasPrefix(path, "/escrow/") ||
			strings.HasPrefix(path, "/media/") || strings.HasPrefix(path, "/feed/") || strings.HasPrefix(path, "/kyc/") ||
			strings.HasPrefix(path, "/marketplace/") || strings.HasPrefix(path, "/business/") || strings.HasPrefix(path, "/rewards/") ||
			strings.HasPrefix(path, "/admin/") ||
			strings.HasPrefix(path, "/api/v1/ledger/") || strings.HasPrefix(path, "/api/v1/media/")

		if isProxyRoute {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
				http.Error(w, "Authorization token required", http.StatusUnauthorized)
				return
			}
			token := strings.TrimPrefix(authHeader, "Bearer ")
			userID, age, err := verifyToken(token)
			if err != nil {
				http.Error(w, "Unauthorized: "+err.Error(), http.StatusUnauthorized)
				return
			}

			// Securely inject the verified claims to downstream microservices
			r.Header.Set("X-User-Id", userID)
			r.Header.Set("X-User-Age", strconv.Itoa(age))
		}

		if strings.HasPrefix(path, "/api/v1/ledger/") {
			r.URL.Path = strings.TrimPrefix(path, "/api/v1/ledger")
			if r.URL.RawPath != "" {
				r.URL.RawPath = strings.TrimPrefix(r.URL.RawPath, "/api/v1/ledger")
			}
			ledgerProxy(w, r)
			return
		}

		if strings.HasPrefix(path, "/api/v1/media/") {
			r.URL.Path = strings.TrimPrefix(path, "/api/v1/media")
			if r.URL.RawPath != "" {
				r.URL.RawPath = strings.TrimPrefix(r.URL.RawPath, "/api/v1/media")
			}
			mediaProxy(w, r)
			return
		}

		if strings.HasPrefix(path, "/wallet/") || strings.HasPrefix(path, "/escrow/") {
			ledgerProxy(w, r)
			return
		}

		if strings.HasPrefix(path, "/media/") || strings.HasPrefix(path, "/feed/") || strings.HasPrefix(path, "/kyc/") || strings.HasPrefix(path, "/marketplace/") || strings.HasPrefix(path, "/business/") || strings.HasPrefix(path, "/rewards/") || strings.HasPrefix(path, "/admin/") {
			mediaProxy(w, r)
			return
		}

		if path == "/health" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"online","service":"nexaverse-gateway"}`))
			return
		}

		// Fallback to serving the frontend web client static assets
		cleanedPath := filepath.Clean(path)
		filePath := filepath.Join("dist", cleanedPath)

		// Check if the requested file exists and is not a directory
		if info, err := os.Stat(filePath); err == nil && !info.IsDir() {
			http.ServeFile(w, r, filePath)
			return
		}

		// Default SPA fallback: serve index.html for all other paths
		http.ServeFile(w, r, filepath.Join("dist", "index.html"))
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("NeXaVerSe Go-Gateway listening on port %s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Server ListenAndServe failed: %v", err)
	}
}

func proxyHandler(target string) http.HandlerFunc {
	targetURL, err := url.Parse(target)
	if err != nil {
		log.Fatalf("Failed to parse proxy target URL %s: %v", target, err)
	}
	proxy := httputil.NewSingleHostReverseProxy(targetURL)

	return func(w http.ResponseWriter, r *http.Request) {
		r.Host = targetURL.Host
		proxy.ServeHTTP(w, r)
	}
}

type JWTClaims struct {
	UserID    string `json:"user_id"`
	Age       int    `json:"age"`
	ExpiresAt int64  `json:"exp"`
}

func createToken(userID string, age int) (string, error) {
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		jwtSecret = "nexaverse-fallback-jwt-secret-key-999"
	}

	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	
	claims := JWTClaims{
		UserID:    userID,
		Age:       age,
		ExpiresAt: time.Now().Add(24 * time.Hour).Unix(),
	}
	
	payloadBytes, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(payloadBytes)

	message := header + "." + payload
	mac := hmac.New(sha256.New, []byte(jwtSecret))
	mac.Write([]byte(message))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	return message + "." + signature, nil
}

func verifyToken(tokenStr string) (string, int, error) {
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		jwtSecret = "nexaverse-fallback-jwt-secret-key-999"
	}

	parts := strings.Split(tokenStr, ".")
	if len(parts) != 3 {
		return "", 0, errors.New("invalid token format")
	}

	header, payload, signature := parts[0], parts[1], parts[2]
	message := header + "." + payload

	mac := hmac.New(sha256.New, []byte(jwtSecret))
	mac.Write([]byte(message))
	expectedSignature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	if signature != expectedSignature {
		return "", 0, errors.New("invalid signature")
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return "", 0, err
	}

	var claims JWTClaims
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return "", 0, err
	}

	if time.Now().Unix() > claims.ExpiresAt {
		return "", 0, errors.New("token expired")
	}

	return claims.UserID, claims.Age, nil
}
