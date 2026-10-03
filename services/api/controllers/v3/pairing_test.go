package v3

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"thread_api/service/pairing"
	"time"

	"github.com/fxamacker/cbor/v2"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt"
)

func pairingRouter(t *testing.T) (*gin.Engine, func(uid string) string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	secret := []byte(strings.Repeat("s", 32))
	r := gin.New()
	RegisterPairing(r, pairing.NewMemory(), secret)
	token := func(uid string) string {
		signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"uid": uid, "admin": false, "authorized": true, "exp": time.Now().Unix() + 60,
		}).SignedString(secret)
		if err != nil {
			t.Fatal(err)
		}
		return signed
	}
	return r, token
}

func pairingCall(t *testing.T, r *gin.Engine, token, method, path string, body map[string]interface{}) (int, map[string]interface{}) {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		raw, err := cbor.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/cbor")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var parsed map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &parsed)
	return w.Code, parsed
}

func TestPairingRelayFlow(t *testing.T) {
	r, token := pairingRouter(t)
	owner := token("user-1")
	const base = "/v3/pairing/session"

	if code, body := pairingCall(t, r, owner, "GET", base, nil); code != 404 || body["code"] != "PAIRING_NOT_FOUND" {
		t.Fatalf("no session: %d %v", code, body)
	}
	code, created := pairingCall(t, r, owner, "POST", base, map[string]interface{}{
		"vaultId": "vault-1", "fingerprint": strings.Repeat("a", 64), "commitment": bytes.Repeat([]byte{1}, 32),
	})
	if code != 200 || created["sessionId"] == nil {
		t.Fatalf("create: %d %v", code, created)
	}
	id := created["sessionId"].(string)

	// Same account on the new device.
	newDevice := token("user-1")
	if code, _ := pairingCall(t, r, newDevice, "POST", base+"/reveal", map[string]interface{}{"sessionId": id, "nonce": bytes.Repeat([]byte{3}, 32)}); code != 409 {
		t.Fatalf("reveal before request: %d", code)
	}
	if code, _ := pairingCall(t, r, newDevice, "POST", base+"/request", map[string]interface{}{"sessionId": id, "request": []byte("signed-request"), "nonce": bytes.Repeat([]byte{2}, 32)}); code != 204 {
		t.Fatalf("request: %d", code)
	}
	if code, _ := pairingCall(t, r, owner, "POST", base+"/reveal", map[string]interface{}{"sessionId": id, "nonce": bytes.Repeat([]byte{3}, 32)}); code != 204 {
		t.Fatalf("reveal: %d", code)
	}
	if code, _ := pairingCall(t, r, owner, "POST", base+"/transfer", map[string]interface{}{"sessionId": id, "transfer": []byte("sealed")}); code != 204 {
		t.Fatalf("transfer: %d", code)
	}
	code, got := pairingCall(t, r, newDevice, "GET", base, nil)
	if code != 200 || got["transfer"] != "c2VhbGVk" || got["request"] != "c2lnbmVkLXJlcXVlc3Q=" || got["fingerprint"] != strings.Repeat("a", 64) {
		t.Fatalf("session: %d %v", code, got)
	}

	// Another account never sees it.
	if code, _ := pairingCall(t, r, token("user-2"), "GET", base, nil); code != 404 {
		t.Fatalf("other account: %d", code)
	}
	if code, _ := pairingCall(t, r, owner, "POST", base+"/cancel", map[string]interface{}{"sessionId": id}); code != 204 {
		t.Fatalf("cancel: %d", code)
	}
	if code, _ := pairingCall(t, r, owner, "GET", base, nil); code != 404 {
		t.Fatalf("after cancel: %d", code)
	}
}

func TestPairingRejectsMalformedBodies(t *testing.T) {
	r, token := pairingRouter(t)
	owner := token("user-1")
	for _, body := range []map[string]interface{}{
		{"vaultId": "vault-1", "fingerprint": "short", "commitment": bytes.Repeat([]byte{1}, 32)},
		{"vaultId": "vault-1", "fingerprint": strings.Repeat("a", 64), "commitment": []byte{1}},
		{"vaultId": "vault-1", "fingerprint": strings.Repeat("a", 64), "commitment": bytes.Repeat([]byte{1}, 32), "extra": 1},
	} {
		if code, _ := pairingCall(t, r, owner, "POST", "/v3/pairing/session", body); code != 400 {
			t.Fatalf("accepted %v: %d", body, code)
		}
	}
	req := httptest.NewRequest("POST", "/v3/pairing/session", strings.NewReader(`{"vaultId":"v"}`))
	req.Header.Set("Authorization", "Bearer "+owner)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != 415 {
		t.Fatalf("json body: %d", w.Code)
	}
	if code, _ := pairingCall(t, r, "not-a-token", "GET", "/v3/pairing/session", nil); code != 401 {
		t.Fatalf("unauthenticated: %d", code)
	}
}
