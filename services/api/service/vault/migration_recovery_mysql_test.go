package vault

import (
	"crypto/ed25519"
	"database/sql"
	"testing"
)

func testLostMigrationCoordinator(t *testing.T, db *sql.DB) {
	t.Run("recovery authority cancels orphaned migration atomically", func(t *testing.T) {
		f := newCancelFixture(t, db, "lost")
		f.upload(1, "lost-one")
		status, err := f.store.Status(f.ctx, f.uid)
		if err != nil {
			t.Fatal(err)
		}
		_, authority := testDevice("cancel-recovery", 42, "write", true)
		_, nextAuthority := testDevice("next-recovery", 56, "write", true)
		next, _ := testDevice("replacement-owner", 57, "write", true)
		body := map[string]interface{}{"vaultId": f.vault, "revision": uint64(1), "previous": status.Head, "operation": "recover", "keyGeneration": uint64(2), "recoveryKey": []byte(nextAuthority.Public().(ed25519.PublicKey)), "devices": []interface{}{next}}
		if _, err = f.store.RecoverPending(f.ctx, f.uid, signed(t, f.key, "recovery", body)); err == nil {
			t.Fatal("device key authorized recovery")
		}
		if f.count("encrypted_objects") != 1 || f.count("vault_migration_active") != 1 {
			t.Fatal("invalid proof changed staged data")
		}
		raw := signed(t, authority, "recovery", body)
		if _, err = f.store.RecoverPending(f.ctx, "other-user", raw); err == nil {
			t.Fatal("cross-account recovery")
		}
		head, err := f.store.RecoverPending(f.ctx, f.uid, raw)
		if err != nil || head.Revision != 1 {
			t.Fatal(head, err)
		}
		f.assertCancelled(1)
		if _, err = f.store.RecoverPending(f.ctx, f.uid, raw); err != nil {
			t.Fatal("lost ACK retry", err)
		}
		var phase string
		if err = db.QueryRowContext(f.ctx, "SELECT phase FROM vault_migrations WHERE migration_id=?", f.status.ID).Scan(&phase); err != nil || phase != "CANCELLED" {
			t.Fatal(phase, err)
		}
		var revoked sql.NullInt64
		if err = db.QueryRowContext(f.ctx, "SELECT revoked_revision FROM vault_devices WHERE vault_id=? AND device_id='cancel-owner'", f.vault).Scan(&revoked); err != nil || !revoked.Valid {
			t.Fatal("old device still authorized", err)
		}
	})
}
