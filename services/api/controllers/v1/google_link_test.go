package v1

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
	"golang.org/x/oauth2"
)

func withGoogleClient(t *testing.T, clientID string) {
	t.Helper()
	previous := config
	config = &oauth2.Config{ClientID: clientID}
	t.Cleanup(func() { config = previous })
}

func TestGoogleLinkTokenRoundTripAndRejection(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "test-access-secret")
	now := time.Unix(1_800_000_000, 0)
	identity := googleIdentity{Id: "google-sub-1", Email: "user@example.invalid", Picture: "https://example.invalid/p.png"}
	token, err := createGoogleLinkToken(identity, now)
	if err != nil {
		t.Fatal(err)
	}
	got, err := parseGoogleLinkToken(token, now.Add(time.Minute))
	if err != nil || got != identity {
		t.Fatalf("round trip failed: %+v %v", got, err)
	}
	if _, err := parseGoogleLinkToken(token, now.Add(googleLinkLifetime)); err == nil {
		t.Fatal("expired link token accepted")
	}
	parts := strings.Split(token, ".")
	tampered := parts[0] + "." + parts[1] + "x." + parts[2]
	if _, err := parseGoogleLinkToken(tampered, now); err == nil {
		t.Fatal("tampered link token accepted")
	}
	// A token signed with the raw access secret (an access-token look-alike) is not a link token.
	forged, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"purpose": googleLinkPurpose, "sub": "victim", "email": "x@example.invalid", "exp": now.Add(time.Minute).Unix(),
	}).SignedString([]byte("test-access-secret"))
	if _, err := parseGoogleLinkToken(forged, now); err == nil {
		t.Fatal("link token signed with the access secret accepted")
	}
	// And a link token never verifies as a Thread access token.
	if parsed, err := jwt.Parse(token, func(*jwt.Token) (interface{}, error) { return []byte("test-access-secret"), nil }); err == nil && parsed.Valid {
		t.Fatal("link token verifies with the access secret")
	}
	key, _ := googleLinkKey()
	wrongPurpose, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"purpose": "other", "sub": "google-sub-1", "email": "user@example.invalid", "exp": now.Add(time.Minute).Unix(),
	}).SignedString(key)
	if _, err := parseGoogleLinkToken(wrongPurpose, now); err == nil {
		t.Fatal("token with another purpose accepted")
	}
	if _, err := createGoogleLinkToken(googleIdentity{Email: "user@example.invalid"}, now); err == nil {
		t.Fatal("link token without Google ID created")
	}
}

func TestPasswordMatches(t *testing.T) {
	stored := "stored-hash"
	empty := ""
	for _, tc := range []struct {
		stored   *string
		provided string
		want     bool
	}{
		{&stored, "stored-hash", true},
		{&stored, "other-hash", false},
		{&stored, "", false},
		{nil, "stored-hash", false},
		{&empty, "", false},
	} {
		if got := passwordMatches(tc.stored, tc.provided); got != tc.want {
			t.Fatalf("passwordMatches(%v, %q) = %v", tc.stored, tc.provided, got)
		}
	}
}

func TestGoogleIdTokenRequiresThreadAudience(t *testing.T) {
	withGoogleClient(t, "thread-web-client")
	t.Setenv("GOOGLE_OAUTH2_ALLOWED_AUDIENCES", " thread-ios-client ,")
	now := time.Unix(1_800_000_000, 0)
	valid := func() jwt.MapClaims {
		return jwt.MapClaims{"iss": "https://accounts.google.com", "aud": "thread-web-client", "sub": "google-sub-1",
			"email": "user@example.invalid", "email_verified": true, "name": "User", "exp": float64(now.Add(time.Hour).Unix())}
	}
	identity, name, err := googleIdTokenIdentity(valid(), now)
	if err != nil || identity.Id != "google-sub-1" || name != "User" {
		t.Fatalf("valid token rejected: %+v %v", identity, err)
	}
	extra := valid()
	extra["aud"] = []interface{}{"other-app", "thread-ios-client"}
	extra["email_verified"] = "true"
	if _, _, err := googleIdTokenIdentity(extra, now); err != nil {
		t.Fatal("configured extra audience rejected", err)
	}
	for name, mutate := range map[string]func(jwt.MapClaims){
		"other app audience": func(c jwt.MapClaims) { c["aud"] = "another-app-client" },
		"missing audience":   func(c jwt.MapClaims) { delete(c, "aud") },
		"wrong issuer":       func(c jwt.MapClaims) { c["iss"] = "https://evil.example" },
		"unverified email":   func(c jwt.MapClaims) { c["email_verified"] = false },
		"expired":            func(c jwt.MapClaims) { c["exp"] = float64(now.Unix()) },
		"missing subject":    func(c jwt.MapClaims) { delete(c, "sub") },
		"non-string name":    func(c jwt.MapClaims) { c["sub"] = 12 },
	} {
		claims := valid()
		mutate(claims)
		if _, _, err := googleIdTokenIdentity(claims, now); err == nil {
			t.Fatal(name, "accepted")
		}
	}
	if googleAudienceAllowed("") {
		t.Fatal("empty audience allowed")
	}
}

func TestGoogleOauthResultPageIsInertAndEscaped(t *testing.T) {
	page, err := googleOauthResultPage(googleAuthResultDto{
		GoogleUserInfo: &GoogleOauth2UserInfo{Email: "</script><script>alert(1)</script>@example.invalid", Id: "1"},
		LinkToken:      "link",
	})
	if err != nil {
		t.Fatal(err)
	}
	html := string(page)
	if strings.Contains(html, "postMessage") || strings.Count(html, "<script") != 1 ||
		!strings.Contains(html, `<script type="application/json" id="`+googleResultID+`">`) {
		t.Fatal("callback page must hold only inert JSON:", html)
	}
	if strings.Contains(html, "</script><script>") {
		t.Fatal("result JSON not HTML-escaped")
	}
	marker := `id="` + googleResultID + `">`
	start := strings.Index(html, marker) + len(marker)
	end := strings.Index(html, "</script>")
	var decoded googleAuthResultDto
	if err := json.Unmarshal([]byte(html[start:end]), &decoded); err != nil || decoded.LinkToken != "link" {
		t.Fatal("result JSON not recoverable", err)
	}
	headers := map[string]string{}
	googleOauthResultHeaders(func(k, v string) { headers[k] = v })
	if headers["Cache-Control"] != "no-store" || !strings.Contains(headers["Content-Security-Policy"], "default-src 'none'") ||
		headers["X-Frame-Options"] != "DENY" {
		t.Fatal("callback page headers", headers)
	}
}

func TestGoogleSignupRejectsClientSuppliedIdentity(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "test-access-secret")
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/google-signup", SignupWithGoogleAuth)
	post := func(body map[string]string) int {
		payload, _ := json.Marshal(body)
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/google-signup", bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, req)
		return recorder.Code
	}
	// The former request shape (raw Google ID, no proof) no longer binds.
	if code := post(map[string]string{"auth_id": "victim", "encrypted_password": "x",
		"google_auth_id": "attacker", "google_email": "a@example.invalid", "google_profile_image_url": "u"}); code != 400 {
		t.Fatal("raw Google identity request", code)
	}
	if code := post(map[string]string{"auth_id": "victim", "encrypted_password": "x", "google_link_token": "forged"}); code != 401 {
		t.Fatal("forged link token", code)
	}
}
