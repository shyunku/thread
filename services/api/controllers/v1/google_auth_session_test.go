package v1

import (
	"context"
	"errors"
	"github.com/golang-jwt/jwt"
	"testing"
	"thread_api/service/session"
	"time"
)

func TestGoogleLoginIssuesThreadTokens(t *testing.T) {
	t.Setenv("JWT_ACCESS_SECRET", "test-access-secret")
	t.Setenv("JWT_REFRESH_SECRET", "test-refresh-secret")
	t.Setenv("JWT_ACCESS_EXPIRE", "3h")
	t.Setenv("JWT_REFRESH_EXPIRE", "7d")
	store := session.NewMemory()
	useSessions(t, store)
	auth, err := createGoogleLoginSession(context.Background(), "user-1")
	if err != nil {
		t.Fatal(err)
	}
	if info, state, err := store.Resolve(context.Background(), session.Hash(auth.RefreshToken.Token)); err != nil || info.UID != "user-1" || state != session.Current {
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
	useSessions(t, failingSessions{store})
	_, err = createGoogleLoginSession(context.Background(), "user-1")
	if err == nil {
		t.Fatal("must reject refresh persistence failure")
	}
}

type failingSessions struct{ session.Store }

func (failingSessions) Create(context.Context, session.Info, string, time.Duration) error {
	return errors.New("redis unavailable")
}
