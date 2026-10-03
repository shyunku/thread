// Package pairing relays a device-connection session between a new device and an
// existing device of the same account. The server only stores and forwards: every
// value is checked end to end by the devices (see
// docs/initiatives/v3-encryption/protocol/v3-relay-pairing.md). The server keeps
// the step order and write-once fields so a confused or stale client cannot
// overwrite an exchange in progress.
package pairing

import (
	"context"
	"errors"
	"regexp"
	"time"
)

const (
	// TTL matches the 10 minute expiry of a pairing request.
	TTL         = 10 * time.Minute
	MaxRequest  = 2048
	MaxTransfer = 512 * 1024
	nonceBytes  = 32
	commitBytes = 32
)

var (
	ErrInvalid  = errors.New("invalid pairing input")
	ErrNotFound = errors.New("pairing session not found")
	// ErrConflict means the session moved on, or this step was already taken.
	ErrConflict = errors.New("pairing step conflict")
)

var (
	sessionIDPattern   = regexp.MustCompile(`^[a-f0-9]{32}$`)
	vaultIDPattern     = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	fingerprintPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
)

// Session is everything the two devices exchange. Empty fields are steps not taken yet.
type Session struct {
	SessionID   string `json:"sessionId"`
	VaultID     string `json:"vaultId"`
	Fingerprint string `json:"fingerprint"`
	Commitment  []byte `json:"commitment"`
	Request     []byte `json:"request,omitempty"`
	NonceN      []byte `json:"nonceN,omitempty"`
	NonceE      []byte `json:"nonceE,omitempty"`
	Transfer    []byte `json:"transfer,omitempty"`
	ExpiresAt   int64  `json:"expiresAt"`
}

type Store interface {
	// Create replaces the account's session with a new one.
	Create(ctx context.Context, uid string, s Session) error
	Get(ctx context.Context, uid string) (Session, error)
	// SubmitRequest stores the new device's request and nonce (once, before reveal).
	SubmitRequest(ctx context.Context, uid, sessionID string, request, nonce []byte) error
	// Reveal stores the existing device's nonce (once, after the request).
	Reveal(ctx context.Context, uid, sessionID string, nonce []byte) error
	// SubmitTransfer stores the sealed key transfer (once, after reveal).
	SubmitTransfer(ctx context.Context, uid, sessionID string, transfer []byte) error
	// Cancel deletes the session if it is still the given one.
	Cancel(ctx context.Context, uid, sessionID string) error
}

func ValidSessionID(id string) bool { return sessionIDPattern.MatchString(id) }

func ValidateNew(s Session) error {
	if !ValidSessionID(s.SessionID) || !vaultIDPattern.MatchString(s.VaultID) ||
		!fingerprintPattern.MatchString(s.Fingerprint) || len(s.Commitment) != commitBytes {
		return ErrInvalid
	}
	return nil
}

func ValidRequest(request, nonce []byte) bool {
	return len(request) > 0 && len(request) <= MaxRequest && len(nonce) == nonceBytes
}

func ValidNonce(nonce []byte) bool { return len(nonce) == nonceBytes }

func ValidTransfer(transfer []byte) bool { return len(transfer) > 0 && len(transfer) <= MaxTransfer }
