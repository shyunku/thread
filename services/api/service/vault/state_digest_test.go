package vault

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"
)

// Same vector as the client's state digest (packages/e2ee synchronize.localStateDigest).
func TestStateDigestRowsMatchClient(t *testing.T) {
	h := sha256.New()
	for _, row := range []struct {
		id      string
		version uint64
		deleted bool
	}{
		{"0123456789abcdef0123456789abcdef", 1, false},
		{"fedcba9876543210fedcba9876543210", 12, true},
	} {
		encoded, err := stateDigestRow(row.id, row.version, row.deleted)
		if err != nil {
			t.Fatal(err)
		}
		h.Write(encoded)
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != "412783326561a2e7cbc0817372b31ed6e3b16ffcdd896197349c82ad68cb303d" {
		t.Fatalf("digest %s", got)
	}
}
