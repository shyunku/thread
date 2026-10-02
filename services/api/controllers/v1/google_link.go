package v1

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt"
)

// Google identities reach signup/linking only through a token this server
// issued after verifying the user with Google in the OAuth callback.
// Client-supplied Google IDs are never trusted.
const (
	googleLinkPurpose  = "google_link"
	googleLinkLifetime = 10 * time.Minute
	googleResultID     = "thread-oauth-result"
)

type googleIdentity struct {
	Id      string
	Email   string
	Picture string
}

var errGoogleLinkInvalid = errors.New("invalid google link token")

// A key derived from the access-token secret, so a link token can never be
// accepted as a Thread access token (and vice versa).
func googleLinkKey() ([]byte, error) {
	secret := os.Getenv("JWT_ACCESS_SECRET")
	if secret == "" {
		return nil, errors.New("missing signing secret")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("thread/google-link/v1"))
	return mac.Sum(nil), nil
}

func createGoogleLinkToken(identity googleIdentity, now time.Time) (string, error) {
	if identity.Id == "" || identity.Email == "" {
		return "", errGoogleLinkInvalid
	}
	key, err := googleLinkKey()
	if err != nil {
		return "", err
	}
	claims := jwt.MapClaims{
		"purpose": googleLinkPurpose,
		"sub":     identity.Id,
		"email":   identity.Email,
		"picture": identity.Picture,
		"iat":     now.Unix(),
		"exp":     now.Add(googleLinkLifetime).Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(key)
}

func parseGoogleLinkToken(raw string, now time.Time) (googleIdentity, error) {
	key, err := googleLinkKey()
	if err != nil {
		return googleIdentity{}, err
	}
	parser := jwt.Parser{SkipClaimsValidation: true}
	token, err := parser.Parse(raw, func(token *jwt.Token) (interface{}, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, errGoogleLinkInvalid
		}
		return key, nil
	})
	if err != nil || !token.Valid {
		return googleIdentity{}, errGoogleLinkInvalid
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return googleIdentity{}, errGoogleLinkInvalid
	}
	purpose, _ := claims["purpose"].(string)
	sub, _ := claims["sub"].(string)
	email, _ := claims["email"].(string)
	picture, _ := claims["picture"].(string)
	exp, _ := claims["exp"].(float64)
	if purpose != googleLinkPurpose || sub == "" || email == "" || int64(exp) <= now.Unix() {
		return googleIdentity{}, errGoogleLinkInvalid
	}
	return googleIdentity{Id: sub, Email: email, Picture: picture}, nil
}

// Stored and provided values are both the client-derived password hash used by Login.
func passwordMatches(stored *string, provided string) bool {
	if stored == nil || *stored == "" || provided == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(*stored), []byte(provided)) == 1
}

// Google tokens must have been issued to Thread's own OAuth clients.
func allowedGoogleAudiences() map[string]bool {
	allowed := map[string]bool{}
	if config != nil && config.ClientID != "" {
		allowed[config.ClientID] = true
	}
	for _, value := range strings.Split(os.Getenv("GOOGLE_OAUTH2_ALLOWED_AUDIENCES"), ",") {
		if value = strings.TrimSpace(value); value != "" {
			allowed[value] = true
		}
	}
	return allowed
}

func googleAudienceAllowed(audience string) bool {
	return audience != "" && allowedGoogleAudiences()[audience]
}

// Validates a Google ID token's claims after its signature has been checked.
func googleIdTokenIdentity(claims jwt.MapClaims, now time.Time) (googleIdentity, string, error) {
	iss, _ := claims["iss"].(string)
	if iss != "accounts.google.com" && iss != "https://accounts.google.com" {
		return googleIdentity{}, "", errors.New("unexpected issuer")
	}
	audienceOK := false
	switch aud := claims["aud"].(type) {
	case string:
		audienceOK = googleAudienceAllowed(aud)
	case []interface{}:
		for _, value := range aud {
			if text, ok := value.(string); ok && googleAudienceAllowed(text) {
				audienceOK = true
			}
		}
	}
	if !audienceOK {
		return googleIdentity{}, "", errors.New("unexpected audience")
	}
	if exp, _ := claims["exp"].(float64); int64(exp) <= now.Unix() {
		return googleIdentity{}, "", errors.New("expired token")
	}
	verified := false
	switch value := claims["email_verified"].(type) {
	case bool:
		verified = value
	case string:
		verified = value == "true"
	}
	sub, _ := claims["sub"].(string)
	email, _ := claims["email"].(string)
	picture, _ := claims["picture"].(string)
	name, _ := claims["name"].(string)
	if !verified || sub == "" || email == "" {
		return googleIdentity{}, "", errors.New("unverified identity")
	}
	return googleIdentity{Id: sub, Email: email, Picture: picture}, name, nil
}

// The callback result is inert JSON read by the desktop main process. It is
// never posted to window.opener, whose origin the server cannot verify.
func googleOauthResultPage(result googleAuthResultDto) ([]byte, error) {
	payload, err := json.Marshal(result) // escapes <, > and & for HTML
	if err != nil {
		return nil, err
	}
	return []byte(fmt.Sprintf(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Thread</title></head>`+
		`<body><script type="application/json" id="%s">%s</script>`+
		`<p>Google 인증을 마쳤습니다. Thread 앱으로 돌아가세요.</p></body></html>`, googleResultID, payload)), nil
}

func googleOauthResultHeaders(set func(string, string)) {
	set("Cache-Control", "no-store")
	set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
	set("X-Frame-Options", "DENY")
	set("Referrer-Policy", "no-referrer")
	set("X-Content-Type-Options", "nosniff")
}
