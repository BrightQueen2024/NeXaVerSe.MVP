package presence

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type PresenceService struct {
	redisCli *redis.Client
	ctx      context.Context
}

func NewPresenceService(redisCli *redis.Client) *PresenceService {
	return &PresenceService{
		redisCli: redisCli,
		ctx:      context.Background(),
	}
}

// SetTyping sets the typing indicator in Redis with a short TTL (e.g., 3s).
// To prevent Redis CPU saturation, we apply a local/sliding-window write lock
// to ensure the client cannot write more than once every 1.5 seconds.
func (p *PresenceService) SetTyping(userID, roomID string) error {
	lockKey := fmt.Sprintf("typing_lock:%s:%s", userID, roomID)
	// Try to set lock key. If it exists, skip writing to Redis to avoid CPU spam
	set, err := p.redisCli.SetNX(p.ctx, lockKey, "1", 1500*time.Millisecond).Result()
	if err != nil {
		return err
	}
	if !set {
		// Rate limited locally
		return nil
	}

	typingKey := fmt.Sprintf("typing:%s:%s", roomID, userID)
	return p.redisCli.Set(p.ctx, typingKey, "1", 3*time.Second).Err()
}

// GetActiveTypingUsers returns all users typing in a room
func (p *PresenceService) GetActiveTypingUsers(roomID string) ([]string, error) {
	pattern := fmt.Sprintf("typing:%s:*", roomID)
	keys, err := p.redisCli.Keys(p.ctx, pattern).Result()
	if err != nil {
		return nil, err
	}

	var users []string
	for _, key := range keys {
		// extract userID from typing:roomID:userID
		var uID string
		_, err := fmt.Sscanf(key, "typing:"+roomID+":%s", &uID)
		if err == nil {
			users = append(users, uID)
		}
	}
	return users, nil
}
