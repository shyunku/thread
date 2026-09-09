package vault

import (
	"testing"
	"time"
)

func TestMigrationProofShapeAndExpiry(t *testing.T) {
	_, key := testDevice("coordinator", 30, "write", true)
	body := map[string]interface{}{"schema": uint64(1), "vaultId": "vault", "deviceId": "coordinator", "epoch": "1", "membershipRevision": uint64(0), "keyGeneration": uint64(1), "operation": "status", "parameters": map[string]interface{}{"migrationId": "attempt"}, "requestId": "request", "expiresAt": uint64(time.Now().Add(time.Minute).UnixMilli())}
	raw := signed(t, key, "migration", body)
	if _, e := parseMigrationControl(raw, "status"); e != nil {
		t.Fatal(e)
	}
	if _, e := parseMigrationControl(raw, "cancel"); e == nil {
		t.Fatal("cross-operation proof")
	}
	for _, expiry := range []uint64{0, uint64(time.Now().Add(-time.Second).UnixMilli()), uint64(time.Now().Add(6 * time.Minute).UnixMilli())} {
		body["expiresAt"] = expiry
		if _, e := parseMigrationControl(signed(t, key, "migration", body), "status"); e == nil {
			t.Fatal("invalid proof lifetime")
		}
	}
}
