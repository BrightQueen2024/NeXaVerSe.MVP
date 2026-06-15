package websocket

import (
	"errors"
	"net"
	"sync"
	"syscall"

	"github.com/gobwas/ws/wsutil"
)

type PeekableConn struct {
	net.Conn
	peekedByte byte
	hasPeeked  bool
	mu         sync.Mutex
}

func (p *PeekableConn) Read(b []byte) (n int, err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.hasPeeked {
		if len(b) > 0 {
			b[0] = p.peekedByte
			p.hasPeeked = false
			if len(b) > 1 {
				n, err = p.Conn.Read(b[1:])
				return n + 1, err
			}
			return 1, nil
		}
	}
	return p.Conn.Read(b)
}

func (p *PeekableConn) Peek() (byte, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.hasPeeked {
		return p.peekedByte, nil
	}
	var buf [1]byte
	n, err := p.Conn.Read(buf[:])
	if err != nil {
		return 0, err
	}
	if n == 1 {
		p.peekedByte = buf[0]
		p.hasPeeked = true
		return p.peekedByte, nil
	}
	return 0, nil
}

func (p *PeekableConn) SyscallConn() (syscall.RawConn, error) {
	if sc, ok := p.Conn.(interface {
		SyscallConn() (syscall.RawConn, error)
	}); ok {
		return sc.SyscallConn()
	}
	return nil, errors.New("underlying connection does not support SyscallConn")
}

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
		Conn:   &PeekableConn{Conn: conn},
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
