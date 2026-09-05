package v1

import (
	"errors"
	"github.com/golang-jwt/jwt"
	"testing"
)

func TestGoogleLoginIssuesThreadTokens(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "test-access-secret")
	t.Setenv("JWT_REFRESH_SECRET", "test-refresh-secret")
	t.Setenv("JWT_ACCESS_EXPIRE", "3h")
	t.Setenv("JWT_REFRESH_EXPIRE", "7d")
	var saved authToken
	auth, err := createGoogleLoginSession("user-1", func(uid string, token authToken) error {
		if uid != "user-1" {
			t.Fatal("wrong refresh owner")
		}
		saved = token
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if saved.Token == "" || saved.Token != auth.RefreshToken.Token {
		t.Fatal("refresh token not saved")
	}
	for _, tc := range []struct{ token, secret string }{
		{auth.AccessToken.Token, "test-access-secret"},
		{auth.RefreshToken.Token, "test-refresh-secret"},
	} {
		parsed, err := jwt.Parse(tc.token, func(token *jwt.Token) (interface{}, error) {
			if token.Method != jwt.SigningMethodHS256 {
				return nil, errors.New("wrong algorithm")
			}
			return []byte(tc.secret), nil
		})
		if err != nil || !parsed.Valid {
			t.Fatalf("invalid Thread token: %v", err)
		}
		if parsed.Claims.(jwt.MapClaims)["uid"] != "user-1" {
			t.Fatal("wrong subject")
		}
	}
	_, err = createGoogleLoginSession("user-1", func(string, authToken) error { return errors.New("redis unavailable") })
	if err == nil {
		t.Fatal("must reject refresh persistence failure")
	}
}
