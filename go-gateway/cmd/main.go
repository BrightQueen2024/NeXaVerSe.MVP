package main

import (
	"context"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"

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
		userID := r.URL.Query().Get("user_id")
		ageStr := r.URL.Query().Get("age")

		if userID == "" {
			http.Error(w, "user_id query parameter required", http.StatusBadRequest)
			return
		}

		age := 20 // Default age to adult if not provided
		if ageStr != "" {
			if parsedAge, err := strconv.Atoi(ageStr); err == nil {
				age = parsedAge
			}
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
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Idempotency-Key, Authorization, X-Internal-Token")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		path := r.URL.Path
		if strings.HasPrefix(path, "/wallet/") || strings.HasPrefix(path, "/escrow/") {
			ledgerProxy(w, r)
			return
		}

		if strings.HasPrefix(path, "/media/") || strings.HasPrefix(path, "/feed/") || strings.HasPrefix(path, "/kyc/") {
			mediaProxy(w, r)
			return
		}

		if path == "/" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"online","service":"nexaverse-gateway"}`))
			return
		}

		http.NotFound(w, r)
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
