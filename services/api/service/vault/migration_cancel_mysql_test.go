package vault

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"thread_api/service/canonical"
)

type cancelFixture struct {
	t                           *testing.T
	db                          *sql.DB
	ctx                         context.Context
	store                       Store
	uid, vault, epoch, snapshot string
	user                        int64
	key                         ed25519.PrivateKey
	status                      MigrationStatus
}

func newCancelFixture(t *testing.T, db *sql.DB, name string) *cancelFixture {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	f := &cancelFixture{t: t, db: db, ctx: ctx, store: Store{db}, uid: "cancel-user-" + name, vault: "cancel-vault-" + name, epoch: uuid.NewString()}
	if _, e := db.ExecContext(ctx, "INSERT INTO user_master(uid) VALUES(?)", f.uid); e != nil {
		t.Fatal(e)
	}
	result, e := db.ExecContext(ctx, "INSERT INTO sync_users(uid,mode,epoch) VALUES(?,'v2',?)", f.uid, f.epoch)
	if e != nil {
		t.Fatal(e)
	}
	f.user, _ = result.LastInsertId()
	device := uuid.NewString()
	if _, e = db.ExecContext(ctx, "INSERT INTO sync_devices(user_id,device_id,last_seen_at) VALUES(?,?,0)", f.user, device); e != nil {
		t.Fatal(e)
	}
	source := &canonical.Store{DB: db}
	if r, e := source.Apply(ctx, f.uid, canonical.Mutation{Epoch: f.epoch, DeviceID: device, ClientChangeID: uuid.NewString(), EntityType: "task", EntityID: uuid.NewString(), Operation: "create", BaseVersion: "0", Changes: map[string]interface{}{"title": "SYNTHETIC_CANCEL_SOURCE"}}); e != nil || r.Status != "accepted" {
		t.Fatal(r, e)
	}
	protocol := canonical.Protocol{Store: source, Key: bytes.Repeat([]byte{4}, 32), Enabled: true}
	snapshot, e := protocol.Snapshot(ctx, f.uid, f.epoch)
	if e != nil {
		t.Fatal(e)
	}
	f.snapshot = snapshot.ID
	owner, key := testDevice("cancel-owner", 41, "write", true)
	f.key = key
	_, recovery := testDevice("cancel-recovery", 42, "write", true)
	if _, e = f.store.Create(ctx, f.uid, signed(t, key, "genesis", map[string]interface{}{"schema": uint64(1), "vaultId": f.vault, "owner": owner, "recoveryKey": []byte(recovery.Public().(ed25519.PublicKey))})); e != nil {
		t.Fatal(e)
	}
	f.prepare("attempt-" + name)
	return f
}
func (f *cancelFixture) request(operation, purpose string, parameters map[string]interface{}) []byte {
	epoch := f.status.TargetEpoch
	if operation == "prepare" {
		epoch = "1"
	}
	return signed(f.t, f.key, purpose, map[string]interface{}{"schema": uint64(1), "vaultId": f.vault, "deviceId": "cancel-owner", "epoch": epoch, "membershipRevision": uint64(0), "keyGeneration": uint64(1), "operation": operation, "parameters": parameters, "requestId": uuid.NewString(), "expiresAt": uint64(time.Now().Add(time.Minute).UnixMilli())})
}
func (f *cancelFixture) prepare(id string) {
	f.t.Helper()
	out, e := f.store.PrepareMigration(f.ctx, f.uid, f.request("prepare", "migration", map[string]interface{}{"migrationId": id, "sourceEpoch": f.epoch, "sourceSnapshotId": f.snapshot, "freezeSeq": "1"}))
	if e != nil {
		f.t.Fatal(e)
	}
	f.status = out
}
func (f *cancelFixture) batch(counter uint64, object string) []byte {
	return signed(f.t, f.key, "mutation", map[string]interface{}{"schema": uint64(2), "vaultId": f.vault, "deviceId": "cancel-owner", "epoch": f.status.TargetEpoch, "membershipRevision": uint64(0), "keyGeneration": uint64(1), "counter": strconv.FormatUint(counter, 10), "mutationId": "batch-" + object, "operations": []interface{}{map[string]interface{}{"objectId": object, "baseVersion": "0", "deleted": false, "fields": []interface{}{map[string]interface{}{"slot": uint64(0), "nonce": bytes.Repeat([]byte{3}, 24), "ciphertext": bytes.Repeat([]byte{5}, 32)}}}}})
}
func (f *cancelFixture) upload(counter uint64, object string) []byte {
	f.t.Helper()
	raw := f.batch(counter, object)
	if _, e := f.store.MigrationPush(f.ctx, f.uid, raw); e != nil {
		f.t.Fatal(e)
	}
	return raw
}
func (f *cancelFixture) snapshotStage() Snapshot {
	f.t.Helper()
	snapshot, e := f.store.MigrationSnapshot(f.ctx, f.uid, f.request("migration-snapshot", "request", map[string]interface{}{}))
	if e != nil {
		f.t.Fatal(e)
	}
	return snapshot
}
func (f *cancelFixture) seal() map[string]interface{} {
	f.t.Helper()
	snapshot := f.snapshotStage()
	out, e := f.store.VerifyMigration(f.ctx, f.uid, f.request("verify", "migration", map[string]interface{}{"migrationId": f.status.ID, "snapshotId": snapshot.ID, "freezeSeq": "1", "ciphertextManifest": snapshot.Digest, "sourcePageCount": uint64(1), "sourceObjectCount": uint64(1)}))
	if e != nil {
		f.t.Fatal(e)
	}
	f.status = out
	return map[string]interface{}{"migrationId": f.status.ID, "targetEpoch": f.status.TargetEpoch, "freezeSeq": "1", "ciphertextManifest": snapshot.Digest}
}
func (f *cancelFixture) cancel(id string) (MigrationStatus, error) {
	return f.store.CancelMigration(f.ctx, f.uid, f.request("cancel", "migration", map[string]interface{}{"migrationId": id}))
}
func (f *cancelFixture) count(table string) int {
	f.t.Helper()
	var n int
	// Test-owned literal table names only; the shared harness requires an empty,
	// explicitly named thread_vault_test_* database before creating these rows.
	if e := f.db.QueryRowContext(f.ctx, "SELECT COUNT(*) FROM "+table+" WHERE vault_id=?", f.vault).Scan(&n); e != nil {
		f.t.Fatal(e)
	}
	return n
}
func (f *cancelFixture) assertCancelled(counter uint64) {
	f.t.Helper()
	for _, table := range []string{"encrypted_objects", "encrypted_changes", "encrypted_receipts", "encrypted_snapshots", "vault_sync"} {
		if f.count(table) != 0 {
			f.t.Fatal("ciphertext left after cancel", table)
		}
	}
	var mode, epoch string
	var n int
	var current uint64
	if e := f.db.QueryRowContext(f.ctx, "SELECT mode FROM sync_users WHERE id=?", f.user).Scan(&mode); e != nil || mode != "v2" {
		f.t.Fatal("source not resumed", e)
	}
	if e := f.db.QueryRowContext(f.ctx, "SELECT mode,epoch FROM vaults WHERE vault_id=?", f.vault).Scan(&mode, &epoch); e != nil || mode != "pending" || epoch != "1" {
		f.t.Fatal("vault not pending", e)
	}
	if e := f.db.QueryRowContext(f.ctx, "SELECT COUNT(*) FROM tasks WHERE user_id=?", f.user).Scan(&n); e != nil || n != 1 {
		f.t.Fatal("source task removed", e)
	}
	if e := f.db.QueryRowContext(f.ctx, "SELECT COUNT(*) FROM sync_snapshots WHERE user_id=? AND id=?", f.user, f.snapshot).Scan(&n); e != nil || n != 1 {
		f.t.Fatal("source snapshot removed", e)
	}
	if e := f.db.QueryRowContext(f.ctx, "SELECT COUNT(*) FROM vault_migration_source_pages WHERE migration_id=?", f.status.ID).Scan(&n); e != nil || n != 1 {
		f.t.Fatal("source recovery copy removed", e)
	}
	if e := f.db.QueryRowContext(f.ctx, "SELECT last_counter FROM vault_devices WHERE vault_id=? AND device_id='cancel-owner'", f.vault).Scan(&current); e != nil || current != counter {
		f.t.Fatal("counter reset", current, e)
	}
	if f.count("vault_migration_active") != 0 {
		f.t.Fatal("active attempt left")
	}
}

func testMigrationCancellation(t *testing.T, db *sql.DB) {
	t.Run("cancel uploaded attempt rollback and exact scope", func(t *testing.T) {
		f := newCancelFixture(t, db, "uploaded")
		raw := f.upload(1, "one")
		snapshot := f.snapshotStage()
		var protected int
		if e := db.QueryRow("SELECT COUNT(*) FROM encrypted_objects WHERE vault_id='migration-vault'").Scan(&protected); e != nil || protected == 0 {
			t.Fatal("active sentinel missing", e)
		}
		if _, e := f.store.CancelMigration(f.ctx, "other-user", f.request("cancel", "migration", map[string]interface{}{"migrationId": f.status.ID})); !errors.Is(e, ErrForbidden) {
			t.Fatal("cross account cleanup", e)
		}
		if _, e := f.cancel("unknown-attempt"); !errors.Is(e, ErrNotFound) {
			t.Fatal("wrong attempt cleanup", e)
		}
		if _, e := f.store.CancelMigration(f.ctx, f.uid, f.request("cancel", "request", map[string]interface{}{"migrationId": f.status.ID})); e == nil {
			t.Fatal("wrong signature purpose")
		}
		// Corrupt provenance is retained, never treated as safe disposable data.
		bad := append([]byte(nil), raw...)
		bad[len(bad)-1] ^= 1
		if _, e := db.Exec("UPDATE encrypted_changes SET signed_record=? WHERE vault_id=?", bad, f.vault); e != nil {
			t.Fatal(e)
		}
		if _, e := f.cancel(f.status.ID); !errors.Is(e, ErrConflict) {
			t.Fatal("ambiguous ciphertext deleted", e)
		}
		if f.count("encrypted_objects") != 1 {
			t.Fatal("provenance failure mutated data")
		}
		if _, e := db.Exec("UPDATE encrypted_changes SET signed_record=? WHERE vault_id=?", raw, f.vault); e != nil {
			t.Fatal(e)
		}
		if _, e := db.Exec(`CREATE TRIGGER fail_cancel_cleanup BEFORE DELETE ON encrypted_changes FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic cancel failure'`); e != nil {
			t.Fatal(e)
		}
		if _, e := f.cancel(f.status.ID); e == nil {
			t.Fatal("injected cleanup failure ignored")
		}
		if _, e := db.Exec("DROP TRIGGER fail_cancel_cleanup"); e != nil {
			t.Fatal(e)
		}
		if f.count("encrypted_objects") != 1 || f.count("encrypted_snapshots") != 1 {
			t.Fatal("partial cleanup was committed")
		}
		cancelled, e := f.cancel(f.status.ID)
		if e != nil || cancelled.Phase != "CANCELLED" {
			t.Fatal("cancel", e)
		}
		f.assertCancelled(1)
		var n int
		if e = db.QueryRow("SELECT COUNT(*) FROM encrypted_snapshot_objects WHERE snapshot_id=?", snapshot.ID).Scan(&n); e != nil || n != 0 {
			t.Fatal("snapshot children left", e)
		}
		if e = db.QueryRow("SELECT COUNT(*) FROM encrypted_objects WHERE vault_id='migration-vault'").Scan(&n); e != nil || n != protected {
			t.Fatal("active vault changed", e)
		}
		if again, e := f.cancel(f.status.ID); e != nil || again != cancelled {
			t.Fatal("cancel retry", e)
		}
		oldID, oldEpoch := f.status.ID, f.status.TargetEpoch
		f.prepare("attempt-uploaded-new")
		if f.status.TargetEpoch == oldEpoch {
			t.Fatal("epoch reused")
		}
		if _, e = f.store.MigrationPush(f.ctx, f.uid, raw); !errors.Is(e, ErrConflict) {
			t.Fatal("cancelled upload replay", e)
		}
		f.upload(2, "two")
		if _, e = f.cancel(oldID); e != nil {
			t.Fatal("old cancel retry", e)
		}
		if f.count("encrypted_objects") != 1 || f.count("vault_migration_active") != 1 {
			t.Fatal("old cancel erased new attempt")
		}
		if _, e = f.cancel(f.status.ID); e != nil {
			t.Fatal(e)
		}
		f.assertCancelled(2)
	})
	t.Run("cancel verified attempt retains signed audit", func(t *testing.T) {
		f := newCancelFixture(t, db, "verified")
		f.upload(1, "one")
		f.seal()
		cancelled, e := f.cancel(f.status.ID)
		if e != nil || cancelled.CiphertextManifest == "" {
			t.Fatal("verified cancel", e)
		}
		f.assertCancelled(1)
		var n int
		if e = db.QueryRow("SELECT COUNT(*) FROM vault_migration_verifications WHERE migration_id=?", f.status.ID).Scan(&n); e != nil || n != 1 {
			t.Fatal("audit removed", e)
		}
		if again, e := f.cancel(f.status.ID); e != nil || again != cancelled {
			t.Fatal("verified retry", e)
		}
	})
	t.Run("cancel serializes with in flight upload", func(t *testing.T) {
		f := newCancelFixture(t, db, "upload-race")
		f.upload(1, "one")
		raw := f.batch(2, "late")
		var wg sync.WaitGroup
		wg.Add(2)
		start := make(chan struct{})
		var cancelErr, uploadErr error
		go func() { defer wg.Done(); <-start; _, cancelErr = f.cancel(f.status.ID) }()
		go func() { defer wg.Done(); <-start; _, uploadErr = f.store.MigrationPush(f.ctx, f.uid, raw) }()
		close(start)
		wg.Wait()
		if cancelErr != nil {
			t.Fatal(cancelErr)
		}
		counter := uint64(1)
		if uploadErr == nil {
			counter = 2
		} else if !errors.Is(uploadErr, ErrInactive) {
			t.Fatal(uploadErr)
		}
		f.assertCancelled(counter)
		if _, e := f.store.MigrationPush(f.ctx, f.uid, raw); !errors.Is(e, ErrInactive) {
			t.Fatal("late upload repopulated vault", e)
		}
	})
	for iteration := 0; iteration < 3; iteration++ {
		t.Run(fmt.Sprintf("cancel serializes with commit %d", iteration), func(t *testing.T) {
			f := newCancelFixture(t, db, fmt.Sprintf("commit-race-%d", iteration))
			f.upload(1, "one")
			params := f.seal()
			commitRaw := f.request("commit", "migration", params)
			cancelRaw := f.request("cancel", "migration", map[string]interface{}{"migrationId": f.status.ID})
			var wg sync.WaitGroup
			wg.Add(2)
			start := make(chan struct{})
			var cancelErr, commitErr error
			go func() { defer wg.Done(); <-start; _, cancelErr = f.store.CancelMigration(f.ctx, f.uid, cancelRaw) }()
			go func() { defer wg.Done(); <-start; _, commitErr = f.store.CommitMigration(f.ctx, f.uid, commitRaw) }()
			close(start)
			wg.Wait()
			if cancelErr == nil {
				if !errors.Is(commitErr, ErrConflict) {
					t.Fatal("both cancel and commit succeeded", commitErr)
				}
				f.assertCancelled(1)
			} else {
				if commitErr != nil || !errors.Is(cancelErr, ErrConflict) {
					t.Fatal("invalid race result", cancelErr, commitErr)
				}
				if f.count("encrypted_objects") != 1 || f.count("encrypted_changes") != 1 {
					t.Fatal("active data removed")
				}
				if _, e := f.cancel(f.status.ID); !errors.Is(e, ErrConflict) {
					t.Fatal("active cancel retry", e)
				}
			}
		})
	}
}
