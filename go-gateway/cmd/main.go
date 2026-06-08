package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/gobwas/ws"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"nexaverse/go-gateway/pkg/websocket"
)

func main() {
	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}

	redisCli := redis.NewClient(&redis.Options{
		Addr: redisAddr,
	})

	// Test Redis connection
	if err := redisCli.Ping(context.Background()).Err(); err != nil {
		log.Printf("Warning: Failed to connect to Redis at %s: %v", redisAddr, err)
	} else {
		log.Printf("Connected to Redis at %s", redisAddr)
	}

	hub, err := websocket.NewHub(redisCli)
	if err != nil {
		log.Fatalf("Failed to initialize hub: %v", err)
	}

	// Start epoll/event loop in a separate goroutine
	go hub.StartEventLoop()

	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
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

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("NeXaVerSe Go-Gateway listening on port %s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Server ListenAndServe failed: %v", err)
	}
}
