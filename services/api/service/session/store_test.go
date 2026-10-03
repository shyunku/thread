package session

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// Both stores must follow the same rules. The Redis run needs a disposable
// server: THREAD_TEST_REDIS_ADDR=127.0.0.1:6379 go test ./service/session
func TestMemoryStore(t *testing.T) {
	m := NewMemory()
	testStore(t, m, func(raw, uid string) { m.Legacy[raw] = uid })
}

func TestRedisStore(t *testing.T) {
	addr := os.Getenv("THREAD_TEST_REDIS_ADDR")
	if addr == "" {
		t.Skip("THREAD_TEST_REDIS_ADDR not set")
	}
	client := redis.NewClient(&redis.Options{Addr: addr})
	t.Cleanup(func() { _ = client.Close() })
	ctx := context.Background()
	if err := client.Ping(ctx).Err(); err != nil {
		t.Fatal(err)
	}
	testStore(t, NewRedis(client), func(raw, uid string) {
		if err := client.Set(ctx, raw, uid, time.Hour).Err(); err != nil {
			t.Fatal(err)
		}
	})
	// The previous scheme stored tokens under arbitrary strings; session keys are never consumed.
	store := NewRedis(client)
	uid := "user-" + uuid.NewString()
	if err := store.Create(ctx, Info{UID: uid, SID: "s"}, "h", time.Hour); err != nil {
		t.Fatal(err)
	}
	if took, err := store.TakeLegacy(ctx, prefix+"sid:s", uid); err != nil || took {
		t.Fatal("session key consumed as legacy token")
	}
	if active, _ := store.Active(ctx, uid, "s"); !active {
		t.Fatal("session key was modified")
	}
	if ttl := client.PTTL(ctx, rtKey("h")).Val(); ttl <= 0 || ttl > time.Hour {
		t.Fatalf("refresh token without expiry: %v", ttl)
	}
}

func testStore(t *testing.T, store Store, setLegacy func(raw, uid string)) {
	ctx := context.Background()
	ttl := time.Hour
	uid := "user-" + uuid.NewString()
	a, b := Info{UID: uid, SID: uuid.NewString()}, Info{UID: uid, SID: uuid.NewString()}
	h := func(name string) string { return Hash(uid + name) }
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	state := func(hash string) State {
		t.Helper()
		_, s, err := store.Resolve(ctx, hash)
		if errors.Is(err, ErrNotFound) {
			return 0
		}
		must(err)
		return s
	}
	active := func(info Info) bool {
		t.Helper()
		ok, err := store.Active(ctx, info.UID, info.SID)
		must(err)
		return ok
	}

	must(store.Create(ctx, a, h("a1"), ttl))
	must(store.Create(ctx, b, h("b1"), ttl))
	if info, s, err := store.Resolve(ctx, h("a1")); err != nil || info != a || s != Current || !active(a) {
		t.Fatalf("created session: %+v %v %v", info, s, err)
	}

	now := time.Now()
	must(store.Rotate(ctx, a, h("a1"), h("a2"), ttl, now))
	if state(h("a1")) != Rotated || state(h("a2")) != Current {
		t.Fatal("rotation did not move the current token")
	}
	if err := store.Rotate(ctx, b, h("a2"), h("x"), ttl, now); !errors.Is(err, ErrNotFound) {
		t.Fatalf("token rotated into another session: %v", err)
	}

	// Lost response: retry inside the grace window replaces the unused successor.
	must(store.Rotate(ctx, a, h("a1"), h("a3"), ttl, now.Add(time.Second)))
	if state(h("a2")) != 0 || state(h("a3")) != Current {
		t.Fatal("grace retry did not replace the successor")
	}
	// Replay after the grace window revokes the session.
	if err := store.Rotate(ctx, a, h("a1"), h("a4"), ttl, now.Add(ReuseGrace+time.Second)); !errors.Is(err, ErrReused) {
		t.Fatalf("replay not detected: %v", err)
	}
	if active(a) || state(h("a4")) != 0 || state(h("a3")) != 0 {
		t.Fatal("replayed session still usable")
	}
	if err := store.Rotate(ctx, a, h("a3"), h("a5"), ttl, now); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoked session rotated: %v", err)
	}
	if !active(b) {
		t.Fatal("other session affected by replay")
	}

	// Rotation chain: replaying a token whose successor was already used is not forgiven.
	c := Info{UID: uid, SID: uuid.NewString()}
	must(store.Create(ctx, c, h("c1"), ttl))
	must(store.Rotate(ctx, c, h("c1"), h("c2"), ttl, now))
	must(store.Rotate(ctx, c, h("c2"), h("c3"), ttl, now))
	if err := store.Rotate(ctx, c, h("c1"), h("c4"), ttl, now.Add(time.Second)); !errors.Is(err, ErrReused) || active(c) {
		t.Fatalf("replay of a used chain not detected: %v", err)
	}

	// Legacy tokens convert once and stop after "log out everywhere".
	setLegacy("legacy-1", uid)
	setLegacy("legacy-2", uid)
	if took, err := store.TakeLegacy(ctx, "legacy-1", "someone-else"); err != nil || took {
		t.Fatal("legacy token taken by another account")
	}
	if took, err := store.TakeLegacy(ctx, "legacy-1", uid); err != nil || !took {
		t.Fatal("legacy token not taken")
	}
	if took, _ := store.TakeLegacy(ctx, "legacy-1", uid); took {
		t.Fatal("legacy token taken twice")
	}
	if !active(Info{UID: uid}) {
		t.Fatal("legacy access refused before revoke")
	}

	d := Info{UID: uid, SID: uuid.NewString()}
	must(store.Create(ctx, d, h("d1"), ttl))
	must(store.RevokeUser(ctx, uid, d.SID, ttl))
	if active(b) || !active(d) || active(Info{UID: uid}) {
		t.Fatal("revoke others did not keep exactly the current session")
	}
	if took, _ := store.TakeLegacy(ctx, "legacy-2", uid); took {
		t.Fatal("legacy token converted after revoke")
	}

	must(store.Revoke(ctx, d))
	if active(d) {
		t.Fatal("logout did not end the session")
	}
	if err := store.Rotate(ctx, d, h("d1"), h("d2"), ttl, now); !errors.Is(err, ErrNotFound) {
		t.Fatalf("logged out session rotated: %v", err)
	}
}
