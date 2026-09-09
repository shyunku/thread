package migrations

import (
	"database/sql"
	"testing"
)

// Called only by the existing empty thread_migration_test_* database harness.
func verifyVaultConstraints(t *testing.T, db *sql.DB) {
	t.Helper()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	exec := func(query string, args ...interface{}) {
		t.Helper()
		if _, e := tx.Exec(query, args...); e != nil {
			t.Fatal(e)
		}
	}
	reject := func(query string, args ...interface{}) {
		t.Helper()
		if _, e := tx.Exec(query, args...); e == nil {
			t.Fatal("invalid vault metadata accepted")
		}
	}
	vaultSQL := `INSERT INTO vaults(vault_id,account_id,epoch,suite,genesis_digest,membership_head,recovery_public_key) VALUES(?,?,'1','thread-e2ee-v1',?,?,?)`
	key := make([]byte, 32)
	exec(vaultSQL, "fixture-vault", "fixture-account", key, key, key)
	reject(vaultSQL, "second-vault", "fixture-account", key, key, key)
	eventSQL := `INSERT INTO vault_membership_events(vault_id,revision,event_digest,signed_record) VALUES('fixture-vault',?,?,?)`
	exec(eventSQL, 0, key, []byte("synthetic-genesis"))
	reject(eventSQL, 0, key, []byte("fork"))
	deviceSQL := `INSERT INTO vault_devices(vault_id,device_id,signing_public_key,encryption_public_key,role,can_authorize_devices,approved_revision) VALUES('fixture-vault',?,?,?, ?,TRUE,?)`
	exec(deviceSQL, "owner", key, key, "write", 0)
	other := make([]byte, 32)
	other[0] = 1
	reject(deviceSQL, "unapproved", other, other, "write", 99)
	reject(deviceSQL, "invalid-role", other, other, "admin", 0)
	envelopeSQL := `INSERT INTO vault_key_envelopes(vault_id,recipient_device_id,key_generation,membership_revision,signed_envelope) VALUES('fixture-vault',?,1,0,?)`
	exec(envelopeSQL, "owner", []byte("synthetic-ciphertext"))
	reject(envelopeSQL, "unknown", []byte("synthetic-ciphertext"))
	reject(envelopeSQL, "owner", []byte("replacement"))
	// This checks relational constraints, NOT cryptographic signature validation.
}
