package session

import (
	"context"
	"sync"
	"time"
)

// Memory is an in-process Store with the same rules as Redis. It is used by tests.
type Memory struct {
	mu        sync.Mutex
	Now       func() time.Time
	current   map[string]memoryToken
	rotated   map[string]memoryRotated
	sids      map[string]memoryValue
	users     map[string]map[string]bool
	legacyOff map[string]time.Time
	Legacy    map[string]string
}

type memoryToken struct {
	info    Info
	expires time.Time
}

type memoryRotated struct {
	info    Info
	at      time.Time
	next    string
	expires time.Time
}

type memoryValue struct {
	uid     string
	expires time.Time
}

func NewMemory() *Memory {
	return &Memory{
		Now:       time.Now,
		current:   map[string]memoryToken{},
		rotated:   map[string]memoryRotated{},
		sids:      map[string]memoryValue{},
		users:     map[string]map[string]bool{},
		legacyOff: map[string]time.Time{},
		Legacy:    map[string]string{},
	}
}

func (m *Memory) alive(info Info) bool {
	value, ok := m.sids[info.SID]
	return ok && value.uid == info.UID && m.Now().Before(value.expires)
}

func (m *Memory) store(info Info, hash string, ttl time.Duration) {
	expires := m.Now().Add(ttl)
	m.current[hash] = memoryToken{info: info, expires: expires}
	m.sids[info.SID] = memoryValue{uid: info.UID, expires: expires}
	if m.users[info.UID] == nil {
		m.users[info.UID] = map[string]bool{}
	}
	m.users[info.UID][info.SID] = true
}

func (m *Memory) revoke(info Info) {
	delete(m.sids, info.SID)
	delete(m.users[info.UID], info.SID)
}

func (m *Memory) Create(_ context.Context, info Info, hash string, ttl time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.store(info, hash, ttl)
	return nil
}

func (m *Memory) Resolve(_ context.Context, hash string) (Info, State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if token, ok := m.current[hash]; ok && m.Now().Before(token.expires) {
		return token.info, Current, nil
	}
	if token, ok := m.rotated[hash]; ok && m.Now().Before(token.expires) {
		return token.info, Rotated, nil
	}
	return Info{}, 0, ErrNotFound
}

func (m *Memory) Rotate(_ context.Context, info Info, oldHash, newHash string, ttl time.Duration, now time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.alive(info) {
		return ErrNotFound
	}
	if token, ok := m.current[oldHash]; ok && m.Now().Before(token.expires) {
		if token.info != info {
			return ErrNotFound
		}
		delete(m.current, oldHash)
		m.rotated[oldHash] = memoryRotated{info: info, at: now, next: newHash, expires: token.expires}
	} else if token, ok := m.rotated[oldHash]; ok && m.Now().Before(token.expires) {
		if token.info != info {
			return ErrNotFound
		}
		next, unused := m.current[token.next]
		if now.Sub(token.at) > ReuseGrace || !unused || next.info != info {
			m.revoke(info)
			delete(m.current, token.next)
			return ErrReused
		}
		delete(m.current, token.next)
		token.next = newHash
		m.rotated[oldHash] = token
	} else {
		return ErrNotFound
	}
	m.store(info, newHash, ttl)
	return nil
}

func (m *Memory) Revoke(_ context.Context, info Info) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.alive(info) {
		m.revoke(info)
	}
	return nil
}

func (m *Memory) RevokeUser(_ context.Context, uid, keepSID string, ttl time.Duration) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for sid := range m.users[uid] {
		if sid != keepSID {
			m.revoke(Info{UID: uid, SID: sid})
		}
	}
	m.legacyOff[uid] = m.Now().Add(ttl)
	return nil
}

func (m *Memory) Active(_ context.Context, uid, sid string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if sid == "" {
		until, off := m.legacyOff[uid]
		return !off || !m.Now().Before(until), nil
	}
	return m.alive(Info{UID: uid, SID: sid}), nil
}

func (m *Memory) TakeLegacy(_ context.Context, raw, uid string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if until, off := m.legacyOff[uid]; off && m.Now().Before(until) {
		return false, nil
	}
	if m.Legacy[raw] != uid {
		return false, nil
	}
	delete(m.Legacy, raw)
	return true, nil
}

func (m *Memory) DropLegacy(_ context.Context, raw, uid string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Legacy[raw] == uid {
		delete(m.Legacy, raw)
	}
	return nil
}
