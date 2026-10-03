// Package session tracks login sessions (refresh token families) so they can be
// rotated, revoked and checked when an access token is used.
//
// A login creates a session ID (sid). Every refresh rotates the refresh token
// inside that session: the used token is remembered for the rest of its
// lifetime, and presenting it again revokes the whole session. Access tokens
// carry the sid, so a revoked session stops working immediately.
package session

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"
)

var (
	// ErrNotFound means the refresh token is unknown, expired or already revoked.
	ErrNotFound = errors.New("session not found")
	// ErrReused means a rotated refresh token was presented again; its session was revoked.
	ErrReused = errors.New("refresh token reused")
	// ErrRevoked means the session behind an access token is no longer active.
	ErrRevoked = errors.New("session revoked")
)

// A client may lose the response of a refresh. Within this window the previous
// token can be exchanged once more, replacing the unused successor instead of
// revoking the session.
const ReuseGrace = 30 * time.Second

// Info identifies the session a refresh token belongs to.
type Info struct {
	UID string
	SID string
}

// State tells whether a refresh token is the current one of its session or an
// already rotated one.
type State int

const (
	Current State = iota + 1
	Rotated
)

type Store interface {
	// Create starts a session whose current refresh token is tokenHash.
	Create(ctx context.Context, info Info, tokenHash string, ttl time.Duration) error
	// Resolve finds the session of a refresh token without changing anything.
	Resolve(ctx context.Context, tokenHash string) (Info, State, error)
	// Rotate replaces oldHash with newHash in the same session. It returns
	// ErrReused (and revokes the session) when oldHash was already rotated
	// outside the grace window, and ErrNotFound when the session is gone.
	Rotate(ctx context.Context, info Info, oldHash, newHash string, ttl time.Duration, now time.Time) error
	// Revoke ends one session.
	Revoke(ctx context.Context, info Info) error
	// RevokeUser ends every session of uid except keepSID (empty keeps none)
	// and stops tokens issued before sessions were tracked.
	RevokeUser(ctx context.Context, uid, keepSID string, ttl time.Duration) error
	// Active reports whether an access token's session is still valid. An empty
	// sid is a token issued before sessions were tracked.
	Active(ctx context.Context, uid, sid string) (bool, error)
	// TakeLegacy consumes a refresh token stored by the previous scheme
	// (raw token key, uid value). It succeeds once per token.
	TakeLegacy(ctx context.Context, rawToken, uid string) (bool, error)
	// DropLegacy deletes a refresh token stored by the previous scheme.
	DropLegacy(ctx context.Context, rawToken, uid string) error
}

// Hash returns the storage key of a refresh token. Raw tokens are never stored.
func Hash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
