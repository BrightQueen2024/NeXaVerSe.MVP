package websocket

import (
	"net"
	"sync"

	"github.com/gobwas/ws/wsutil"
)

type Client struct {
	ID        string
	UserID    string
	Age       int // Used for Sandbox checks (15-17 vs 20+)
	Conn      net.Conn
	mu        sync.Mutex
	isClosed  bool
}

func NewClient(id, userID string, age int, conn net.Conn) *Client {
	return &Client{
		ID:     id,
		UserID: userID,
		Age:    age,
		Conn:   conn,
	}
}

func (c *Client) Send(message []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.isClosed {
		return net.ErrClosed
	}
	return wsutil.WriteServerMessage(c.Conn, 1, message) // Write text frame
}

func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.isClosed {
		return nil
	}
	c.isClosed = true
	return c.Conn.Close()
}
