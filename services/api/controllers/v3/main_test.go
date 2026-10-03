package v3

import (
	"context"
	"os"
	"testing"
)

type allowSessions struct{}

func (allowSessions) Active(context.Context, string, string) (bool, error) { return true, nil }

// Route tests exercise authorization and payload rules; session checks are tested in auth_test.go.
func TestMain(m *testing.M) {
	SetSessionVerifier(allowSessions{})
	os.Exit(m.Run())
}
