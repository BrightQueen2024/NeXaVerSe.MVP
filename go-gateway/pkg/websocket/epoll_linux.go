//go:build linux

package websocket

import (
	"fmt"
	"net"
	"sync"
	"syscall"

	"golang.org/x/sys/unix"
)

type Epoll struct {
	fd          int
	connections map[int]net.Conn
	lock        *sync.RWMutex
}

func NewEpoll() (*Epoll, error) {
	fd, err := unix.EpollCreate1(0)
	if err != nil {
		return nil, err
	}
	return &Epoll{
		fd:          fd,
		connections: make(map[int]net.Conn),
		lock:        &sync.RWMutex{},
	}, nil
}

func (e *Epoll) Add(conn net.Conn) error {
	fd := socketFD(conn)
	e.lock.Lock()
	defer e.lock.Unlock()

	err := unix.EpollCtl(e.fd, unix.EPOLL_CTL_ADD, fd, &unix.EpollEvent{
		Events: unix.EPOLLIN | unix.EPOLLHUP | unix.EPOLLERR | unix.EPOLLET,
		Fd:     int32(fd),
	})
	if err != nil {
		return err
	}
	e.connections[fd] = conn
	return nil
}

func (e *Epoll) Remove(conn net.Conn) error {
	fd := socketFD(conn)
	e.lock.Lock()
	defer e.lock.Unlock()

	err := unix.EpollCtl(e.fd, unix.EPOLL_CTL_DEL, fd, nil)
	if err != nil {
		return err
	}
	delete(e.connections, fd)
	return nil
}

func (e *Epoll) Wait() ([]net.Conn, error) {
	events := make([]unix.EpollEvent, 128)
	n, err := unix.EpollWait(e.fd, events, -1)
	if err != nil && err != syscall.EINTR {
		return nil, err
	}

	e.lock.RLock()
	defer e.lock.RUnlock()

	var conns []net.Conn
	for i := 0; i < n; i++ {
		conn := e.connections[int(events[i].Fd)]
		if conn != nil {
			conns = append(conns, conn)
		}
	}
	return conns, nil
}

func socketFD(conn net.Conn) int {
	sc, ok := conn.(interface {
		SyscallConn() (syscall.RawConn, error)
	})
	if !ok {
		return 0
	}
	rawConn, err := sc.SyscallConn()
	if err != nil {
		return 0
	}
	var fdVal int
	err = rawConn.Control(func(fd uintptr) {
		fdVal = int(fd)
	})
	if err != nil {
		return 0
	}
	return fdVal
}
