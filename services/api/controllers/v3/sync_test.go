package v3

import (
	"context"
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
	"net/http/httptest"
	"strings"
	"testing"
	"thread_api/service/vault"
	"time"
)

type syncFixture struct {
	calls int
	uid   string
	err   error
}

func (s *syncFixture) SignedEnvelope(_ context.Context, u string, _ []byte) (vault.Envelope, error) {
	return vault.Envelope{}, s.count(u)
}

func (s *syncFixture) count(uid string) error { s.calls++; s.uid = uid; return s.err }
func (s *syncFixture) Push(_ context.Context, u string, _ []byte) (vault.PushResult, error) {
	return vault.PushResult{Seq: "1"}, s.count(u)
}
func (s *syncFixture) SignedPull(_ context.Context, u string, _ []byte) (vault.Changes, error) {
	return vault.Changes{}, s.count(u)
}
func (s *syncFixture) SignedSnapshot(_ context.Context, u string, _ []byte) (vault.Snapshot, error) {
	return vault.Snapshot{}, s.count(u)
}
func (s *syncFixture) SignedSnapshotPage(_ context.Context, u string, _ []byte) (vault.SnapshotPage, error) {
	return vault.SnapshotPage{}, s.count(u)
}
func TestEncryptedSyncHTTPBoundary(t *testing.T) {
	gin.SetMode(gin.TestMode)
	secret := []byte(strings.Repeat("s", 32))
	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"uid": "fixture-user", "admin": false, "authorized": true, "exp": time.Now().Unix() + 60}).SignedString(secret)
	for _, tc := range []struct {
		path, body, media string
		err               error
		status            int
	}{
		{"push", "x", "application/cbor", nil, 200},
		{"pull?accountId=other", "x", "application/cbor", nil, 200},
		{"snapshot", "x", "application/cbor", vault.ErrQuota, 429},
		{"snapshot/page", "x", "application/cbor", vault.ErrForbidden, 403},
		{"push", "x", "application/cbor", vault.ErrObjectConflict, 409},
		{"pull", "x", "application/cbor", vault.ErrConflict, 409},
		{"push", "x", "application/cbor", vault.ErrInactive, 409},
		{"pull", "x", "application/cbor", errors.New("PRIVATE_DB_ERROR"), 500},
		{"pull", "{}", "application/json", nil, 415},
		{"push", strings.Repeat("x", vault.MaxBytes+1), "application/cbor", nil, 413},
	} {
		s := &syncFixture{err: tc.err}
		r := gin.New()
		RegisterSync(r, s, secret)
		req := httptest.NewRequest("POST", "/v3/sync/"+tc.path, strings.NewReader(tc.body))
		req.Header.Set("Content-Type", tc.media)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != tc.status || strings.Contains(w.Body.String(), "PRIVATE_DB_ERROR") || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s status %d", tc.path, w.Code)
		}
		if s.calls > 0 && s.uid != "fixture-user" {
			t.Fatal("account source changed")
		}
	}
	s := &syncFixture{}
	r := gin.New()
	RegisterSync(r, s, secret)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("POST", "/v3/sync/pull", strings.NewReader("x")))
	if w.Code != 401 || s.calls != 0 {
		t.Fatal("unsigned account reached store")
	}
}
