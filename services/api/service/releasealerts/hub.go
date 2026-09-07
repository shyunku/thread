package releasealerts

import "sync"

type Event struct {
	Topic   string `json:"topic"`
	Version string `json:"version"`
}

var mu sync.Mutex
var subscribers = map[chan Event]struct{}{}

func Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, 8)
	mu.Lock()
	subscribers[ch] = struct{}{}
	mu.Unlock()
	return ch, func() { mu.Lock(); delete(subscribers, ch); mu.Unlock() }
}

func Broadcast(version string) int {
	mu.Lock()
	defer mu.Unlock()
	event := Event{Topic: "release.available", Version: version}
	for ch := range subscribers {
		select {
		case ch <- event:
		default:
			// Slow peers will recover from durable RMS state; never block other sockets.
		}
	}
	return len(subscribers)
}
