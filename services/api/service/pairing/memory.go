package pairing

import (
	"context"
	"sync"
	"time"
)

// Memory is an in-process Store with the same rules as Redis. It is used by tests.
type Memory struct {
	mu       sync.Mutex
	Now      func() time.Time
	sessions map[string]Session
}

func NewMemory() *Memory { return &Memory{Now: time.Now, sessions: map[string]Session{}} }

func (m *Memory) live(uid string) (Session, bool) {
	s, ok := m.sessions[uid]
	if ok && m.Now().UnixMilli() >= s.ExpiresAt {
		delete(m.sessions, uid)
		return Session{}, false
	}
	return s, ok
}

func (m *Memory) Create(_ context.Context, uid string, s Session) error {
	if err := ValidateNew(s); err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[uid] = Session{SessionID: s.SessionID, VaultID: s.VaultID, Fingerprint: s.Fingerprint,
		Commitment: append([]byte(nil), s.Commitment...), ExpiresAt: s.ExpiresAt}
	return nil
}

func (m *Memory) Get(_ context.Context, uid string) (Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.live(uid)
	if !ok {
		return Session{}, ErrNotFound
	}
	return s, nil
}

func (m *Memory) step(uid, sessionID string, apply func(*Session) error) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.live(uid)
	if !ok || s.SessionID != sessionID {
		return ErrNotFound
	}
	if err := apply(&s); err != nil {
		return err
	}
	m.sessions[uid] = s
	return nil
}

func (m *Memory) SubmitRequest(_ context.Context, uid, sessionID string, request, nonce []byte) error {
	if !ValidSessionID(sessionID) || !ValidRequest(request, nonce) {
		return ErrInvalid
	}
	return m.step(uid, sessionID, func(s *Session) error {
		if s.Request != nil {
			return ErrConflict
		}
		s.Request, s.NonceN = append([]byte(nil), request...), append([]byte(nil), nonce...)
		return nil
	})
}

func (m *Memory) Reveal(_ context.Context, uid, sessionID string, nonce []byte) error {
	if !ValidSessionID(sessionID) || !ValidNonce(nonce) {
		return ErrInvalid
	}
	return m.step(uid, sessionID, func(s *Session) error {
		if s.Request == nil || s.NonceE != nil {
			return ErrConflict
		}
		s.NonceE = append([]byte(nil), nonce...)
		return nil
	})
}

func (m *Memory) SubmitTransfer(_ context.Context, uid, sessionID string, transfer []byte) error {
	if !ValidSessionID(sessionID) || !ValidTransfer(transfer) {
		return ErrInvalid
	}
	return m.step(uid, sessionID, func(s *Session) error {
		if s.NonceE == nil || s.Transfer != nil {
			return ErrConflict
		}
		s.Transfer = append([]byte(nil), transfer...)
		return nil
	})
}

func (m *Memory) Cancel(_ context.Context, uid, sessionID string) error {
	if !ValidSessionID(sessionID) {
		return ErrInvalid
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.sessions[uid]; ok && s.SessionID == sessionID {
		delete(m.sessions, uid)
	}
	return nil
}
