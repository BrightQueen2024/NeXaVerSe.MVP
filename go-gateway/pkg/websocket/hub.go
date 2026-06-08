package websocket

import (
	"context"
	"encoding/json"
	"log"
	"net"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

type Hub struct {
	clients    map[string]*Client // map of connection ID -> Client
	users      map[string]*Client // map of user ID -> Client (for DM routing)
	lock       sync.RWMutex
	epoll      *Epoll
	redisCli   *redis.Client
	ctx        context.Context
}

type ChatMessage struct {
	SenderID   string `json:"sender_id"`
	ReceiverID string `json:"receiver_id"`
	Content    string `json:"content"`
	Timestamp  int64  `json:"timestamp"`
}

func NewHub(redisCli *redis.Client) (*Hub, error) {
	ep, err := NewEpoll()
	if err != nil {
		return nil, err
	}
	return &Hub{
		clients:  make(map[string]*Client),
		users:    make(map[string]*Client),
		epoll:    ep,
		redisCli: redisCli,
		ctx:      context.Background(),
	}, nil
}

func (h *Hub) Register(c *Client) error {
	h.lock.Lock()
	h.clients[c.ID] = c
	h.users[c.UserID] = c
	h.lock.Unlock()

	// Add connection to epoll event loop
	if err := h.epoll.Add(c.Conn); err != nil {
		h.Unregister(c)
		return err
	}

	// Publish presence update to Redis
	h.setPresence(c.UserID, "online")
	return nil
}

func (h *Hub) Unregister(c *Client) {
	h.lock.Lock()
	defer h.lock.Unlock()

	if _, exists := h.clients[c.ID]; exists {
		delete(h.clients[c.ID])
		delete(h.users[c.UserID])
		_ = h.epoll.Remove(c.Conn)
		_ = c.Close()
		h.setPresence(c.UserID, "offline")
	}
}

func (h *Hub) StartEventLoop() {
	for {
		conns, err := h.epoll.Wait()
		if err != nil {
			log.Printf("Epoll wait error: %v", err)
			continue
		}

		for _, conn := range conns {
			h.handleRead(conn)
		}
	}
}

func (h *Hub) handleRead(conn net.Conn) {
	h.lock.RLock()
	var client *Client
	for _, c := range h.clients {
		if c.Conn == conn {
			client = c
			break
		}
	}
	h.lock.RUnlock()

	if client == nil {
		return
	}

	// Read frame
	buf := make([]byte, 1024)
	n, err := conn.Read(buf)
	if err != nil {
		h.Unregister(client)
		return
	}

	if n == 0 {
		return
	}

	// Process inbound message
	var msg ChatMessage
	if err := json.Unmarshal(buf[:n], &msg); err != nil {
		log.Printf("Failed to unmarshal chat message: %v", err)
		return
	}

	msg.SenderID = client.UserID
	msg.Timestamp = time.Now().UnixMilli()

	// Apply Sandbox checks if either user is a minor (ages 15-17)
	if h.isMinor(client.Age) {
		if !h.checkMutualFriends(client.UserID, msg.ReceiverID) {
			log.Printf("Sandbox block: minor %s attempted DM to unlinked account %s", client.UserID, msg.ReceiverID)
			return
		}
	}

	// Route to receiver if online locally
	h.lock.RLock()
	receiver, exists := h.users[msg.ReceiverID]
	h.lock.RUnlock()

	if exists {
		// Sandbox check for receiver (if receiver is a minor)
		if h.isMinor(receiver.Age) && !h.checkMutualFriends(msg.SenderID, receiver.UserID) {
			log.Printf("Sandbox block: adult %s attempted DM to minor %s", msg.SenderID, receiver.UserID)
			return
		}

		respData, _ := json.Marshal(msg)
		_ = receiver.Send(respData)
	} else {
		// Publish to NATS/Redis PubSub to route to other gateway nodes
		respData, _ := json.Marshal(msg)
		h.redisCli.Publish(h.ctx, "nexa_dms", respData)
	}
}

func (h *Hub) isMinor(age int) bool {
	return age >= 15 && age <= 17
}

// Stub implementation for security sandbox friend link verification
func (h *Hub) checkMutualFriends(userA, userB string) bool {
	// Query Redis or Postgres cache for friend relationship
	// In production, this checks if the minor has a mutual connection
	val, err := h.redisCli.SIsMember(h.ctx, "friends:"+userA, userB).Result()
	if err != nil {
		return false
	}
	return val
}

func (h *Hub) setPresence(userID, status string) {
	// Set presence with an expiration of 5 minutes
	h.redisCli.Set(h.ctx, "presence:"+userID, status, 5*time.Minute)
}
