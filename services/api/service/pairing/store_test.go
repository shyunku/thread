package pairing

import (
	"bytes"
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// Both stores must follow the same rules. The Redis run needs a disposable
// server: THREAD_TEST_REDIS_ADDR=127.0.0.1:6379 go test ./service/pairing
func TestMemoryStore(t *testing.T) { testStore(t, NewMemory()) }

func TestRedisStore(t *testing.T) {
	addr := os.Getenv("THREAD_TEST_REDIS_ADDR")
	if addr == "" {
		t.Skip("THREAD_TEST_REDIS_ADDR not set")
	}
	client := redis.NewClient(&redis.Options{Addr: addr})
	t.Cleanup(func() { _ = client.Close() })
	if err := client.Ping(context.Background()).Err(); err != nil {
		t.Fatal(err)
	}
	testStore(t, NewRedis(client))
	uid := "user-" + uuid.NewString()
	store := NewRedis(client)
	if err := store.Create(context.Background(), uid, session(time.Now().Add(TTL))); err != nil {
		t.Fatal(err)
	}
	if ttl := client.PTTL(context.Background(), key(uid)).Val(); ttl <= 0 || ttl > TTL {
		t.Fatalf("session without expiry: %v", ttl)
	}
}

func fill(n int, b byte) []byte { return bytes.Repeat([]byte{b}, n) }

func session(expires time.Time) Session {
	return Session{SessionID: uuid.NewString()[:8] + "0123456789abcdef0123456789ab"[:24], VaultID: "vault-1",
		Fingerprint: string(bytes.Repeat([]byte("a"), 64)), Commitment: fill(32, 1), ExpiresAt: expires.UnixMilli()}
}

func testStore(t *testing.T, store Store) {
	ctx := context.Background()
	uid := "user-" + uuid.NewString()
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	is := func(err, want error) {
		t.Helper()
		if !errors.Is(err, want) {
			t.Fatalf("got %v, want %v", err, want)
		}
	}

	if _, err := store.Get(ctx, uid); !errors.Is(err, ErrNotFound) {
		t.Fatalf("empty account: %v", err)
	}
	bad := session(time.Now().Add(TTL))
	bad.Fingerprint = "zz"
	is(store.Create(ctx, uid, bad), ErrInvalid)

	s := session(time.Now().Add(TTL))
	must(store.Create(ctx, uid, s))
	got, err := store.Get(ctx, uid)
	must(err)
	if got.SessionID != s.SessionID || got.VaultID != "vault-1" || !bytes.Equal(got.Commitment, s.Commitment) || got.Request != nil {
		t.Fatalf("created session: %+v", got)
	}

	// Steps run in order, once each.
	is(store.Reveal(ctx, uid, s.SessionID, fill(32, 3)), ErrConflict)
	is(store.SubmitTransfer(ctx, uid, s.SessionID, fill(10, 4)), ErrConflict)
	is(store.SubmitRequest(ctx, uid, s.SessionID, fill(MaxRequest+1, 2), fill(32, 2)), ErrInvalid)
	is(store.SubmitRequest(ctx, uid, "ffffffffffffffffffffffffffffffff", fill(100, 2), fill(32, 2)), ErrNotFound)
	must(store.SubmitRequest(ctx, uid, s.SessionID, fill(100, 2), fill(32, 2)))
	is(store.SubmitRequest(ctx, uid, s.SessionID, fill(100, 9), fill(32, 9)), ErrConflict)
	must(store.Reveal(ctx, uid, s.SessionID, fill(32, 3)))
	is(store.Reveal(ctx, uid, s.SessionID, fill(32, 8)), ErrConflict)
	must(store.SubmitTransfer(ctx, uid, s.SessionID, fill(MaxTransfer, 4)))
	is(store.SubmitTransfer(ctx, uid, s.SessionID, fill(10, 7)), ErrConflict)
	got, err = store.Get(ctx, uid)
	must(err)
	if !bytes.Equal(got.Request, fill(100, 2)) || !bytes.Equal(got.NonceN, fill(32, 2)) || !bytes.Equal(got.NonceE, fill(32, 3)) || len(got.Transfer) != MaxTransfer {
		t.Fatal("steps not stored")
	}

	// A new session replaces the old one; a stale id cannot cancel it.
	next := session(time.Now().Add(TTL))
	must(store.Create(ctx, uid, next))
	got, err = store.Get(ctx, uid)
	must(err)
	if got.SessionID != next.SessionID || got.Request != nil {
		t.Fatal("old session leaked into the new one")
	}
	must(store.Cancel(ctx, uid, s.SessionID))
	if _, err := store.Get(ctx, uid); err != nil {
		t.Fatal("stale cancel removed the current session")
	}
	must(store.Cancel(ctx, uid, next.SessionID))
	if _, err := store.Get(ctx, uid); !errors.Is(err, ErrNotFound) {
		t.Fatal("cancel did not remove the session")
	}

	// Sessions are per account.
	must(store.Create(ctx, uid, next))
	if _, err := store.Get(ctx, uid+"-other"); !errors.Is(err, ErrNotFound) {
		t.Fatal("session visible to another account")
	}
}

func TestMemoryExpiry(t *testing.T) {
	m := NewMemory()
	now := time.Now()
	m.Now = func() time.Time { return now }
	s := session(now.Add(TTL))
	if err := m.Create(context.Background(), "u", s); err != nil {
		t.Fatal(err)
	}
	now = now.Add(TTL)
	if _, err := m.Get(context.Background(), "u"); !errors.Is(err, ErrNotFound) {
		t.Fatal("expired session still served")
	}
}
