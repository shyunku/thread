package v1

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"thread_api/libs/crypto"
	"thread_api/service/session"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
)

func useSessions(t *testing.T, store session.Store) {
	t.Helper()
	previous := Sessions
	Sessions = store
	t.Cleanup(func() { Sessions = previous })
}

func sessionTestEnv(t *testing.T) *session.Memory {
	t.Helper()
	t.Setenv("JWT_ACCESS_SECRET", "test-access-secret")
	t.Setenv("JWT_REFRESH_SECRET", "test-refresh-secret")
	t.Setenv("JWT_ACCESS_EXPIRE", "3h")
	t.Setenv("JWT_REFRESH_EXPIRE", "7d")
	previousKey := crypto.JwtSecretKey
	crypto.JwtSecretKey = "test-access-secret"
	t.Cleanup(func() { crypto.JwtSecretKey = previousKey })
	store := session.NewMemory()
	useSessions(t, store)
	return store
}

func sessionRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	UseAuthRouter(r.Group("/v1"))
	r.GET("/protected", AuthMiddleware, func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"uid": c.GetString("uid"), "sid": c.GetString("sid")})
	})
	return r
}

type sessionCall struct {
	status int
	code   string
	auth   authTokenDto
}

func call(t *testing.T, r *gin.Engine, method, path string, headers map[string]string, body string) sessionCall {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	result := sessionCall{status: w.Code}
	var parsed struct {
		Code string `json:"code"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &parsed)
	result.code = parsed.Code
	_ = json.Unmarshal(w.Body.Bytes(), &result.auth)
	return result
}

func refresh(t *testing.T, r *gin.Engine, token string) sessionCall {
	return call(t, r, http.MethodPost, "/v1/auth/refreshToken", map[string]string{"X-Refresh-Token": token}, "")
}

func protected(t *testing.T, r *gin.Engine, access string) sessionCall {
	return call(t, r, http.MethodGet, "/protected", map[string]string{"Authorization": "Bearer " + access}, "")
}

// Admin sessions avoid the user table, so these tests need no database.
func login(t *testing.T) *authTokenDto {
	t.Helper()
	auth, err := issueSession(context.Background(), adminTokenSubject, true)
	if err != nil {
		t.Fatal(err)
	}
	return auth
}

func TestRefreshRotatesAndDetectsReuse(t *testing.T) {
	sessionTestEnv(t)
	r := sessionRouter()
	first := login(t)

	second := refresh(t, r, first.RefreshToken.Token)
	if second.status != http.StatusOK || second.auth.RefreshToken.Token == "" || second.auth.RefreshToken.Token == first.RefreshToken.Token {
		t.Fatalf("refresh failed: %+v", second)
	}
	if got := protected(t, r, second.auth.AccessToken.Token); got.status != http.StatusOK {
		t.Fatalf("new access token rejected: %d", got.status)
	}

	// A lost response: the previous token works once more within the grace window
	// and replaces the unused successor.
	retry := refresh(t, r, first.RefreshToken.Token)
	if retry.status != http.StatusOK {
		t.Fatalf("grace retry failed: %+v", retry)
	}
	if got := refresh(t, r, second.auth.RefreshToken.Token); got.status != http.StatusUnauthorized {
		t.Fatalf("replaced successor must not refresh: %d", got.status)
	}

	// After the grace window the old token is a replay: the whole session ends.
	defer func(previous func() time.Time) { sessionNow = previous }(sessionNow)
	sessionNow = func() time.Time { return time.Now().Add(session.ReuseGrace + time.Second) }
	if got := refresh(t, r, first.RefreshToken.Token); got.status != http.StatusUnauthorized || got.code != "REFRESH_TOKEN_REUSED" {
		t.Fatalf("reuse not detected: %+v", got)
	}
	if got := refresh(t, r, retry.auth.RefreshToken.Token); got.status != http.StatusUnauthorized {
		t.Fatalf("revoked session refreshed: %d", got.status)
	}
	if got := protected(t, r, retry.auth.AccessToken.Token); got.status != http.StatusUnauthorized || got.code != "SESSION_REVOKED" {
		t.Fatalf("revoked session access token accepted: %+v", got)
	}
}

func TestReuseOfAUsedSuccessorIsNotForgiven(t *testing.T) {
	sessionTestEnv(t)
	r := sessionRouter()
	first := login(t)
	second := refresh(t, r, first.RefreshToken.Token)
	third := refresh(t, r, second.auth.RefreshToken.Token)
	if third.status != http.StatusOK {
		t.Fatalf("second rotation failed: %d", third.status)
	}
	// The successor was already used, so this is not a lost response.
	if got := refresh(t, r, first.RefreshToken.Token); got.code != "REFRESH_TOKEN_REUSED" {
		t.Fatalf("reuse inside grace must revoke when the successor was used: %+v", got)
	}
	if got := protected(t, r, third.auth.AccessToken.Token); got.code != "SESSION_REVOKED" {
		t.Fatalf("session must be revoked: %+v", got)
	}
}

func TestLogoutEndsOnlyThatSession(t *testing.T) {
	sessionTestEnv(t)
	r := sessionRouter()
	mine, other := login(t), login(t)
	if got := call(t, r, http.MethodPost, "/v1/auth/logout", map[string]string{"X-Refresh-Token": mine.RefreshToken.Token}, ""); got.status != http.StatusNoContent {
		t.Fatalf("logout failed: %d", got.status)
	}
	if got := refresh(t, r, mine.RefreshToken.Token); got.status != http.StatusUnauthorized {
		t.Fatalf("logged out token refreshed: %d", got.status)
	}
	if got := protected(t, r, mine.AccessToken.Token); got.code != "SESSION_REVOKED" {
		t.Fatalf("logged out access token accepted: %+v", got)
	}
	if got := protected(t, r, other.AccessToken.Token); got.status != http.StatusOK {
		t.Fatalf("other session affected: %d", got.status)
	}
	// Logging out again, or with garbage, still lets the client clear its state.
	for _, token := range []string{mine.RefreshToken.Token, "not-a-token"} {
		if got := call(t, r, http.MethodPost, "/v1/auth/logout", map[string]string{"X-Refresh-Token": token}, ""); got.status != http.StatusNoContent {
			t.Fatalf("repeated logout: %d", got.status)
		}
	}
}

func TestRevokeOtherSessions(t *testing.T) {
	sessionTestEnv(t)
	r := sessionRouter()
	mine, other := login(t), login(t)
	headers := map[string]string{"Authorization": "Bearer " + mine.AccessToken.Token}
	if got := call(t, r, http.MethodPost, "/v1/auth/sessions/revoke", headers, `{"keep_current":true}`); got.status != http.StatusNoContent {
		t.Fatalf("revoke failed: %+v", got)
	}
	if got := protected(t, r, other.AccessToken.Token); got.code != "SESSION_REVOKED" {
		t.Fatalf("other session still active: %+v", got)
	}
	if got := refresh(t, r, other.RefreshToken.Token); got.status != http.StatusUnauthorized {
		t.Fatalf("other session refreshed: %d", got.status)
	}
	if got := protected(t, r, mine.AccessToken.Token); got.status != http.StatusOK {
		t.Fatalf("current session revoked: %d", got.status)
	}
	if got := call(t, r, http.MethodPost, "/v1/auth/sessions/revoke", headers, `{"keep_current":false}`); got.status != http.StatusNoContent {
		t.Fatalf("revoke all failed: %+v", got)
	}
	if got := protected(t, r, mine.AccessToken.Token); got.code != "SESSION_REVOKED" {
		t.Fatalf("current session survived revoke all: %+v", got)
	}
}

// Tokens issued before sessions were tracked: refresh tokens stored under their
// raw value and access tokens without a sid.
func legacyTokens(t *testing.T, uid string) (string, string) {
	t.Helper()
	sign := func(secret string, claims jwt.MapClaims) string {
		token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
		if err != nil {
			t.Fatal(err)
		}
		return token
	}
	exp := time.Now().Add(time.Hour).Unix()
	access := sign("test-access-secret", jwt.MapClaims{"uid": uid, "admin": true, "exp": exp, "authorized": true})
	refresh := sign("test-refresh-secret", jwt.MapClaims{"uid": uid, "admin": true, "exp": exp, "uuid": time.Now().String()})
	return access, refresh
}

func TestLegacyTokensConvertOnceAndStopAfterRevokeAll(t *testing.T) {
	store := sessionTestEnv(t)
	r := sessionRouter()
	access, raw := legacyTokens(t, adminTokenSubject)
	store.Legacy[raw] = adminTokenSubject

	if got := protected(t, r, access); got.status != http.StatusOK {
		t.Fatalf("legacy access token rejected during transition: %d", got.status)
	}
	converted := refresh(t, r, raw)
	if converted.status != http.StatusOK {
		t.Fatalf("legacy refresh failed: %+v", converted)
	}
	if got := refresh(t, r, raw); got.status != http.StatusUnauthorized {
		t.Fatalf("legacy token converted twice: %d", got.status)
	}
	if got := protected(t, r, converted.auth.AccessToken.Token); got.status != http.StatusOK {
		t.Fatalf("converted session rejected: %d", got.status)
	}

	// Keeping the current session needs a token that has one.
	legacyHeaders := map[string]string{"Authorization": "Bearer " + access}
	if got := call(t, r, http.MethodPost, "/v1/auth/sessions/revoke", legacyHeaders, `{"keep_current":true}`); got.code != "SESSION_REFRESH_REQUIRED" {
		t.Fatalf("legacy keep_current: %+v", got)
	}

	_, other := legacyTokens(t, adminTokenSubject)
	store.Legacy[other] = adminTokenSubject
	headers := map[string]string{"Authorization": "Bearer " + converted.auth.AccessToken.Token}
	if got := call(t, r, http.MethodPost, "/v1/auth/sessions/revoke", headers, `{"keep_current":true}`); got.status != http.StatusNoContent {
		t.Fatalf("revoke failed: %+v", got)
	}
	if got := protected(t, r, access); got.code != "SESSION_REVOKED" {
		t.Fatalf("legacy access token survived revoke: %+v", got)
	}
	if got := refresh(t, r, other); got.status != http.StatusUnauthorized {
		t.Fatalf("legacy refresh token survived revoke: %d", got.status)
	}
	if got := protected(t, r, converted.auth.AccessToken.Token); got.status != http.StatusOK {
		t.Fatalf("kept session revoked: %d", got.status)
	}
}

func TestRefreshRequiresOurSignature(t *testing.T) {
	store := sessionTestEnv(t)
	r := sessionRouter()
	// A stored value under an arbitrary key must not become a session.
	store.Legacy["thread:session:sid:anything"] = adminTokenSubject
	store.Legacy["forged"] = adminTokenSubject
	for _, token := range []string{"thread:session:sid:anything", "forged"} {
		if got := refresh(t, r, token); got.status != http.StatusUnauthorized || got.code != "INVALID_REFRESH_TOKEN" {
			t.Fatalf("unsigned token accepted: %+v", got)
		}
	}
	_, wrongKey := legacyTokens(t, adminTokenSubject)
	t.Setenv("JWT_REFRESH_SECRET", "rotated-secret")
	store.Legacy[wrongKey] = adminTokenSubject
	if got := refresh(t, r, wrongKey); got.status != http.StatusUnauthorized {
		t.Fatalf("token with another key accepted: %d", got.status)
	}
}

func TestSessionsUnavailableFailClosed(t *testing.T) {
	sessionTestEnv(t)
	r := sessionRouter()
	auth := login(t)
	useSessions(t, nil)
	if got := refresh(t, r, auth.RefreshToken.Token); got.status != http.StatusServiceUnavailable {
		t.Fatalf("refresh without store: %d", got.status)
	}
	if got := protected(t, r, auth.AccessToken.Token); got.status != http.StatusServiceUnavailable {
		t.Fatalf("access without store: %d", got.status)
	}
	if _, err := issueSession(context.Background(), adminTokenSubject, true); err == nil {
		t.Fatal("login without store must fail")
	}
}
