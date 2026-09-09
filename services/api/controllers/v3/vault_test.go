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

type testVault struct {
	calls int
	uid   string
	err   error
}

func (s *testVault) Create(_ context.Context, uid string, _ []byte) (vault.Head, error) {
	s.calls++
	s.uid = uid
	return vault.Head{VaultID: "fixture"}, s.err
}
func (s *testVault) ApplyPending(c context.Context, uid string, b []byte) (vault.Head, error) {
	return s.Create(c, uid, b)
}
func (s *testVault) RecoverPending(c context.Context, uid string, b []byte) (vault.Head, error) {
	return s.Create(c, uid, b)
}
func (s *testVault) ApplyTransition(c context.Context, uid string, b []byte) (vault.Head, error) {
	return s.Create(c, uid, b)
}
func (s *testVault) Read(_ context.Context, uid string, _ uint64) (vault.Page, error) {
	s.calls++
	s.uid = uid
	return vault.Page{}, s.err
}
func TestPendingHTTPBoundary(t *testing.T) {
	gin.SetMode(gin.TestMode)
	secret := []byte(strings.Repeat("s", 32))
	token, e := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"uid": "fixture-user", "authorized": true, "admin": false, "exp": time.Now().Unix() + 60}).SignedString(secret)
	if e != nil {
		t.Fatal(e)
	}
	cases := []struct {
		method, path, content, body string
		err                         error
		want, calls                 int
	}{
		{"POST", "/v3/vault", "application/cbor", "x", nil, 200, 1},
		{"POST", "/v3/vault/membership", "application/cbor", "x", vault.ErrConflict, 409, 1},
		{"POST", "/v3/vault/recovery", "application/cbor", "x", vault.ErrForbidden, 403, 1},
		{"POST", "/v3/vault/transition", "application/cbor", "x", vault.ErrConflict, 409, 1},
		{"POST", "/v3/vault", "application/json", "{}", nil, 415, 0},
		{"POST", "/v3/vault", "application/cbor", strings.Repeat("x", vault.MaxBytes+1), nil, 413, 0},
		{"GET", "/v3/vault?after=01", "", "", nil, 400, 0},
		{"GET", "/v3/vault?after=0&accountId=other", "", "", nil, 200, 1},
		{"GET", "/v3/vault", "", "", errors.New("SYNTHETIC_PRIVATE_SQL"), 500, 1},
	}
	for _, tc := range cases {
		s := &testVault{err: tc.err}
		r := gin.New()
		RegisterPending(r, s, secret)
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", tc.content)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != tc.want || s.calls != tc.calls {
			t.Fatalf("%s: status=%d calls=%d", tc.path, w.Code, s.calls)
		}
		if s.calls > 0 && s.uid != "fixture-user" {
			t.Fatal("body selected account")
		}
		if strings.Contains(w.Body.String(), "SYNTHETIC_PRIVATE_SQL") {
			t.Fatal("raw error disclosed")
		}
	}
	s := &testVault{}
	r := gin.New()
	RegisterPending(r, s, secret)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("POST", "/v3/vault", strings.NewReader("x")))
	if w.Code != 401 || s.calls != 0 {
		t.Fatal("unauthenticated route reached store")
	}
}
