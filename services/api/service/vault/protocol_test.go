package vault

import (
	"bytes"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

func signed(t *testing.T, key ed25519.PrivateKey, purpose string, body map[string]interface{}) []byte {
	t.Helper()
	message, e := Encode([]interface{}{Suite, purpose, body})
	if e != nil {
		t.Fatal(e)
	}
	raw, e := Encode(map[string]interface{}{"body": body, "signature": []byte(ed25519.Sign(key, message))})
	if e != nil {
		t.Fatal(e)
	}
	return raw
}
func testDevice(id string, seed byte, role string, auth bool) (map[string]interface{}, ed25519.PrivateKey) {
	key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{seed}, 32))
	return map[string]interface{}{"id": id, "role": role, "canAuthorizeDevices": auth, "signingKey": []byte(key.Public().(ed25519.PublicKey)), "encryptionKey": bytes.Repeat([]byte{seed + 1}, 32)}, key
}
func TestDesktopGenesisVector(t *testing.T) {
	raw, e := os.ReadFile("../../../../docs/protocol/e2ee-genesis-vector.json")
	if e != nil {
		t.Fatal(e)
	}
	var v struct {
		GenesisHex  string
		Fingerprint string
	}
	if e = json.Unmarshal(raw, &v); e != nil {
		t.Fatal(e)
	}
	encoded, e := hex.DecodeString(v.GenesisHex)
	if e != nil {
		t.Fatal(e)
	}
	g, e := ParseGenesis(encoded)
	if e != nil {
		t.Fatal(e)
	}
	if HeadString(g.Digest) != v.Fingerprint || g.ID != "cross-language" {
		t.Fatal("desktop/server genesis mismatch")
	}
	encoded[len(encoded)-1] ^= 1
	if _, e = ParseGenesis(encoded); e == nil {
		t.Fatal("tampered signature accepted")
	}
}
func TestRejectNonCanonicalAndUnsafeTypes(t *testing.T) {
	for _, hexed := range []string{"1801", "a2616101616102", "9f01ff", "c001", "f7", "f93c00", "1b0020000000000000", "a16b636f6e7374727563746f7201", "0000"} {
		raw, _ := hex.DecodeString(hexed)
		if _, e := Decode(raw); e == nil {
			t.Fatalf("accepted %s", hexed)
		}
	}
	if _, e := Decode(make([]byte, MaxBytes+1)); e == nil {
		t.Fatal("oversize accepted")
	}
}
