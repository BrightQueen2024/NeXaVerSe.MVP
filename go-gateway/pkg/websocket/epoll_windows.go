//go:build !linux

package websocket

import (
	"net"
	"sync"
)

// Epoll is a mock/fallback event poller for non-Linux OS (development/testing)
type Epoll struct {
	connections map[net.Conn]bool
	lock        *sync.RWMutex
	trigger     chan net.Conn
}

func NewEpoll() (*Epoll, error) {
	return &Epoll{
		connections: make(map[net.Conn]bool),
		lock:        &sync.RWMutex{},
		trigger:     make(chan net.Conn, 1000),
	}, nil
}

func (e *Epoll) Add(conn net.Conn) error {
	e.lock.Lock()
	defer e.lock.Unlock()
	e.connections[conn] = true
	// Start a monitoring goroutine to simulate read-readiness trigger
	go func() {
		if pc, ok := conn.(*PeekableConn); ok {
			_, err := pc.Peek()
			if err != nil {
				e.trigger <- conn
				return
			}
			e.trigger <- conn
		} else {
			buf := make([]byte, 1)
			_, err := conn.Read(buf)
			if err != nil {
				e.trigger <- conn
				return
			}
			e.trigger <- conn
		}
	}()
	return nil
}

func (e *Epoll) Remove(conn net.Conn) error {
	e.lock.Lock()
	defer e.lock.Unlock()
	delete(e.connections, conn)
	return nil
}

func (e *Epoll) Wait() ([]net.Conn, error) {
	conn := <-e.trigger
	e.lock.RLock()
	defer e.lock.RUnlock()
	if e.connections[conn] {
		return []net.Conn{conn}, nil
	}
	return nil, nil
}
