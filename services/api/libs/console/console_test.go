package console

import (
	"errors"
	"testing"
)

func TestErrorfForwardsArguments(t *testing.T) {
	if got := Errorf("%s: %d", "fixture", 7).Error(); got != "fixture: 7" {
		t.Fatal(got)
	}
	cause := errors.New("fixture error")
	if !errors.Is(Errorf("wrapped: %w", cause), cause) {
		t.Fatal("error chain lost")
	}
}
