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

type migrationFixture struct {
	calls int
	uid   string
	err   error
}

func (s *migrationFixture) MigrationPush(_ context.Context, u string, _ []byte) (vault.PushResult, error) {
	return vault.PushResult{}, s.call(u)
}
func (s *migrationFixture) MigrationSnapshot(_ context.Context, u string, _ []byte) (vault.Snapshot, error) {
	return vault.Snapshot{}, s.call(u)
}
func (s *migrationFixture) MigrationSnapshotPage(_ context.Context, u string, _ []byte) (vault.SnapshotPage, error) {
	return vault.SnapshotPage{}, s.call(u)
}
func (s *migrationFixture) VerifyMigration(_ context.Context, u string, _ []byte) (vault.MigrationStatus, error) {
	return vault.MigrationStatus{}, s.call(u)
}
func (s *migrationFixture) CommitMigration(_ context.Context, u string, _ []byte) (vault.MigrationStatus, error) {
	return vault.MigrationStatus{}, s.call(u)
}

func (s *migrationFixture) call(u string) error { s.calls++; s.uid = u; return s.err }
func (s *migrationFixture) PrepareMigration(_ context.Context, u string, _ []byte) (vault.MigrationStatus, error) {
	return vault.MigrationStatus{}, s.call(u)
}
func (s *migrationFixture) MigrationStatus(_ context.Context, u string, _ []byte) (vault.MigrationStatus, error) {
	return vault.MigrationStatus{}, s.call(u)
}
func (s *migrationFixture) CancelMigration(_ context.Context, u string, _ []byte) (vault.MigrationStatus, error) {
	return vault.MigrationStatus{}, s.call(u)
}
func (s *migrationFixture) MigrationSource(_ context.Context, u string, _ []byte) (vault.MigrationSourcePage, error) {
	return vault.MigrationSourcePage{}, s.call(u)
}
func TestMigrationHTTPBoundary(t *testing.T) {
	gin.SetMode(gin.TestMode)
	key := []byte(strings.Repeat("s", 32))
	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"uid": "fixture-user", "admin": false, "authorized": true, "exp": time.Now().Unix() + 60}).SignedString(key)
	for _, tc := range []struct {
		path, body, media, auth string
		err                     error
		status                  int
	}{
		{"prepare", "x", "application/cbor", token, nil, 200},
		{"push", "x", "application/cbor", token, nil, 200},
		{"snapshot", "x", "application/cbor", token, nil, 200},
		{"snapshot/page", "x", "application/cbor", token, nil, 200},
		{"verify", "x", "application/cbor", token, nil, 200},
		{"commit", "x", "application/cbor", token, vault.ErrConflict, 409},
		{"status?accountId=other", "x", "application/cbor", token, nil, 200},
		{"source", "x", "application/cbor", token, vault.ErrForbidden, 403},
		{"cancel", "x", "application/cbor", token, vault.ErrConflict, 409},
		{"prepare", "x", "application/cbor", token, vault.ErrMigrationSourceLimit, 413},
		{"status", "x", "application/cbor", token, errors.New("PRIVATE_DB_ERROR"), 500},
		{"prepare", "x", "application/json", token, nil, 415},
		{"prepare", strings.Repeat("x", vault.MaxBytes+1), "application/cbor", token, nil, 413},
		{"prepare", "x", "application/cbor", "", nil, 401},
	} {
		s := &migrationFixture{err: tc.err}
		r := gin.New()
		RegisterMigration(r, s, key)
		req := httptest.NewRequest("POST", "/v3/migration/"+tc.path, strings.NewReader(tc.body))
		req.Header.Set("Content-Type", tc.media)
		req.Header.Set("Authorization", "Bearer "+tc.auth)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != tc.status || strings.Contains(w.Body.String(), "PRIVATE_DB_ERROR") || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s status %d", tc.path, w.Code)
		}
		if s.calls > 0 && s.uid != "fixture-user" {
			t.Fatal("account identity not derived from JWT")
		}
	}
}
