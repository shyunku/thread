package canonical

import (
	"github.com/google/uuid"
	"strings"
	"testing"
)

func TestBoundCursor(t *testing.T) {
	p := Protocol{Key: []byte(strings.Repeat("x", 32))}
	epoch := uuid.NewString()
	token := p.Cursor("one", epoch, "9007199254740993")
	n, e := p.parseCursor(token, "one", epoch)
	if e != nil || n != 9007199254740993 {
		t.Fatal(n, e)
	}
	for _, tc := range []struct{ token, uid, epoch, code string }{
		{token, "two", epoch, "CURSOR_FORBIDDEN"}, {token, "one", uuid.NewString(), "RESET_REQUIRED"},
		{token + "a", "one", epoch, "INVALID_CURSOR"}, {p.Cursor("one", epoch, "01"), "one", epoch, "INVALID_CURSOR"},
	} {
		_, e = p.parseCursor(tc.token, tc.uid, tc.epoch)
		if ErrorCode(e) != tc.code {
			t.Fatal(e, tc.code)
		}
	}
}
