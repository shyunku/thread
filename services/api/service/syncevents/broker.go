// Package syncevents tells an account's connected devices that new encrypted
// changes are waiting. It carries no data: devices pull and verify as before.
// The broker is in-process, which matches the single API instance.
package syncevents

import "sync"

type Broker struct {
	mu     sync.Mutex
	nextID int
	subs   map[string]map[int]chan struct{}
}

func NewBroker() *Broker { return &Broker{subs: map[string]map[int]chan struct{}{}} }

// Subscribe returns a channel that receives a signal after each change for uid.
// Signals coalesce: a slow reader sees at most one pending signal.
func (b *Broker) Subscribe(uid string) (<-chan struct{}, func()) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.nextID++
	id, ch := b.nextID, make(chan struct{}, 1)
	if b.subs[uid] == nil {
		b.subs[uid] = map[int]chan struct{}{}
	}
	b.subs[uid][id] = ch
	return ch, func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		delete(b.subs[uid], id)
		if len(b.subs[uid]) == 0 {
			delete(b.subs, uid)
		}
	}
}

// Notify signals every subscriber of uid without blocking.
func (b *Broker) Notify(uid string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for _, ch := range b.subs[uid] {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

// Subscribers is the number of open streams for uid (tests, diagnostics).
func (b *Broker) Subscribers(uid string) int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.subs[uid])
}
