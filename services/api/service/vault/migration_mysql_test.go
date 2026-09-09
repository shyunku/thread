package vault

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"database/sql"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"sync"
	"testing"
	"thread_api/service/canonical"
	"time"
)

// Called only by the harness that requires an empty synthetic test database.
func testMigrationFreeze(t *testing.T, db *sql.DB) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	uid, epoch, deviceID := "migration-user", uuid.NewString(), uuid.NewString()
	if _, e := db.ExecContext(ctx, "INSERT INTO user_master(uid) VALUES(?)", uid); e != nil {
		t.Fatal(e)
	}
	result, e := db.ExecContext(ctx, "INSERT INTO sync_users(uid,mode,epoch) VALUES(?,'v2',?)", uid, epoch)
	if e != nil {
		t.Fatal(e)
	}
	user, _ := result.LastInsertId()
	if _, e = db.ExecContext(ctx, "INSERT INTO sync_devices(user_id,device_id,last_seen_at) VALUES(?,?,0)", user, deviceID); e != nil {
		t.Fatal(e)
	}
	source := &canonical.Store{DB: db}
	protocol := canonical.Protocol{Store: source, Key: bytes.Repeat([]byte{7}, 32), Enabled: true}
	mutation := func() canonical.Mutation {
		return canonical.Mutation{Epoch: epoch, DeviceID: deviceID, ClientChangeID: uuid.NewString(), EntityType: "task", EntityID: uuid.NewString(), Operation: "create", BaseVersion: "0", Changes: map[string]interface{}{"title": "SYNTHETIC_MIGRATION_PRIVATE"}}
	}
	if r, e := source.Apply(ctx, uid, mutation()); e != nil || r.Status != "accepted" {
		t.Fatal("source create", r, e)
	}
	snapshot, e := protocol.Snapshot(ctx, uid, epoch)
	if e != nil {
		t.Fatal(e)
	}
	sourcePage, e := protocol.SnapshotPage(ctx, uid, epoch, snapshot.ID, 0)
	if e != nil {
		t.Fatal(e)
	}
	store := Store{db}
	owner, key := testDevice("migration-owner", 25, "write", true)
	_, recovery := testDevice("migration-recovery", 26, "write", true)
	genesis := signed(t, key, "genesis", map[string]interface{}{"schema": uint64(1), "vaultId": "migration-vault", "recoveryKey": []byte(recovery.Public().(ed25519.PublicKey)), "owner": owner})
	if _, e = store.Create(ctx, uid, genesis); e != nil {
		t.Fatal(e)
	}
	proof := func(operation string, params map[string]interface{}) []byte {
		return signed(t, key, "migration", map[string]interface{}{
			"schema": uint64(1), "vaultId": "migration-vault", "deviceId": "migration-owner", "epoch": "1", "membershipRevision": uint64(0), "keyGeneration": uint64(1),
			"operation": operation, "parameters": params, "requestId": uuid.NewString(), "expiresAt": uint64(time.Now().Add(time.Minute).UnixMilli()),
		})
	}
	params := map[string]interface{}{"migrationId": "attempt-one", "sourceEpoch": epoch, "sourceSnapshotId": snapshot.ID, "freezeSeq": "0"}
	if _, e = store.PrepareMigration(ctx, uid, proof("prepare", params)); !errors.Is(e, ErrConflict) {
		t.Fatal("stale source accepted", e)
	}
	params["freezeSeq"] = snapshot.Seq
	frozen, e := store.PrepareMigration(ctx, uid, proof("prepare", params))
	if e != nil || frozen.Phase != "FROZEN" || frozen.ObjectCount != 1 {
		t.Fatal("prepare", frozen, e)
	}
	if _, e = source.Apply(ctx, uid, mutation()); canonical.ErrorCode(e) != "UPDATE_REQUIRED" {
		t.Fatal("v2 write passed freeze", e)
	}
	account, e := protocol.Account(ctx, uid)
	if e != nil || account.Mode != "e2ee_frozen" {
		t.Fatal("frozen account reprovisioned", account, e)
	}
	if _, e = protocol.Snapshot(ctx, uid, epoch); canonical.ErrorCode(e) != "UPDATE_REQUIRED" {
		t.Fatal("v2 read passed freeze", e)
	}
	query := map[string]interface{}{"migrationId": "attempt-one"}
	if status, e := store.MigrationStatus(ctx, uid, proof("status", query)); e != nil || status != frozen {
		t.Fatal("status after lost prepare ACK", status, e)
	}
	if _, e = store.MigrationStatus(ctx, "other-user", proof("status", query)); !errors.Is(e, ErrForbidden) {
		t.Fatal("cross-account migration", e)
	}
	pageParams := map[string]interface{}{"migrationId": "attempt-one", "page": uint64(0)}
	if page, e := store.MigrationSource(ctx, uid, proof("source-page", pageParams)); e != nil || page.Payload != sourcePage.Payload || page.Checksum != sourcePage.Checksum {
		t.Fatal("source bytes changed", e)
	}
	// Original snapshot retention must not make the frozen migration unrecoverable.
	if _, e = db.ExecContext(ctx, "DELETE FROM sync_snapshot_pages WHERE user_id=? AND snapshot_id=?", user, snapshot.ID); e != nil {
		t.Fatal(e)
	}
	if _, e = db.ExecContext(ctx, "DELETE FROM sync_snapshots WHERE user_id=? AND id=?", user, snapshot.ID); e != nil {
		t.Fatal(e)
	}
	if retry, e := store.PrepareMigration(ctx, uid, proof("prepare", params)); e != nil || retry != frozen {
		t.Fatal("prepare retry depends on expiring snapshot", e)
	}
	if page, e := store.MigrationSource(ctx, uid, proof("source-page", pageParams)); e != nil || page.Payload != sourcePage.Payload {
		t.Fatal("frozen source expired", e)
	}
	if cancelled, e := store.CancelMigration(ctx, uid, proof("cancel", query)); e != nil || cancelled.Phase != "CANCELLED" {
		t.Fatal("cancel", e)
	}
	if _, e = store.CancelMigration(ctx, uid, proof("cancel", query)); e != nil {
		t.Fatal("cancel retry", e)
	}
	var mode string
	var count int
	if e = db.QueryRowContext(ctx, "SELECT mode FROM sync_users WHERE id=?", user).Scan(&mode); e != nil || mode != "v2" {
		t.Fatal("cancel did not restore v2", e)
	}
	if e = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM tasks WHERE user_id=?", user).Scan(&count); e != nil || count != 1 {
		t.Fatal("source data deleted", e)
	}
	if e = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM vault_migration_source_pages WHERE migration_id='attempt-one'").Scan(&count); e != nil || count != 1 {
		t.Fatal("cancel removed source recovery copy", e)
	}
	if _, e = store.MigrationSource(ctx, uid, proof("source-page", pageParams)); !errors.Is(e, ErrConflict) {
		t.Fatal("cancelled source remained available", e)
	}
	if r, e := source.Apply(ctx, uid, mutation()); e != nil || r.Status != "accepted" {
		t.Fatal("v2 resume", e)
	}
	snapshot, e = protocol.Snapshot(ctx, uid, epoch)
	if e != nil {
		t.Fatal(e)
	}
	params = map[string]interface{}{"migrationId": "attempt-race", "sourceEpoch": epoch, "sourceSnapshotId": snapshot.ID, "freezeSeq": snapshot.Seq}
	// Either the writer wins and prepare rejects its stale checkpoint, or freeze
	// wins and the writer is rejected. They must never both succeed.
	var wg sync.WaitGroup
	wg.Add(2)
	start := make(chan struct{})
	var prepareErr, writeErr error
	var race MigrationStatus
	var written canonical.Result
	prepareRaw := proof("prepare", params)
	change := mutation()
	go func() { defer wg.Done(); <-start; race, prepareErr = store.PrepareMigration(ctx, uid, prepareRaw) }()
	go func() { defer wg.Done(); <-start; written, writeErr = source.Apply(ctx, uid, change) }()
	close(start)
	wg.Wait()
	if prepareErr == nil {
		if canonical.ErrorCode(writeErr) != "UPDATE_REQUIRED" || race.TargetEpoch == frozen.TargetEpoch {
			t.Fatal("freeze/write race lost isolation", written, writeErr)
		}
		if _, e = store.CancelMigration(ctx, uid, proof("cancel", map[string]interface{}{"migrationId": "attempt-race"})); e != nil {
			t.Fatal(e)
		}
	} else if !errors.Is(prepareErr, ErrConflict) || writeErr != nil || written.Status != "accepted" {
		t.Fatal("race result", prepareErr, written, writeErr)
	}
	// A failed copy rolls back the mode, lease and checkpoint together.
	snapshot, e = protocol.Snapshot(ctx, uid, epoch)
	if e != nil {
		t.Fatal(e)
	}
	params = map[string]interface{}{"migrationId": "attempt-failure", "sourceEpoch": epoch, "sourceSnapshotId": snapshot.ID, "freezeSeq": snapshot.Seq}
	if _, e = db.ExecContext(ctx, `CREATE TRIGGER fail_migration_copy BEFORE INSERT ON vault_migration_source_pages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic failure'`); e != nil {
		t.Fatal(e)
	}
	if _, e = store.PrepareMigration(ctx, uid, proof("prepare", params)); e == nil {
		t.Fatal("injected failure ignored")
	}
	if _, e = db.ExecContext(ctx, "DROP TRIGGER fail_migration_copy"); e != nil {
		t.Fatal(e)
	}
	if e = db.QueryRowContext(ctx, "SELECT mode FROM sync_users WHERE id=?", user).Scan(&mode); e != nil || mode != "v2" {
		t.Fatal("partial freeze after rollback", e)
	}
	if e = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM vault_migrations WHERE migration_id='attempt-failure'").Scan(&count); e != nil || count != 0 {
		t.Fatal("partial checkpoint", e)
	}
	params["migrationId"] = "attempt-complete"
	final, e := store.PrepareMigration(ctx, uid, proof("prepare", params))
	if e != nil {
		t.Fatal(e)
	}
	bodyFor := func(operation string, parameters map[string]interface{}) map[string]interface{} {
		return map[string]interface{}{
			"schema": uint64(1), "vaultId": "migration-vault", "deviceId": "migration-owner", "epoch": final.TargetEpoch, "membershipRevision": uint64(0), "keyGeneration": uint64(1),
			"operation": operation, "parameters": parameters, "requestId": uuid.NewString(), "expiresAt": uint64(time.Now().Add(time.Minute).UnixMilli()),
		}
	}
	control := func(operation string, parameters map[string]interface{}) []byte {
		return signed(t, key, "migration", bodyFor(operation, parameters))
	}
	read := func(operation string, parameters map[string]interface{}) []byte {
		return signed(t, key, "request", bodyFor(operation, parameters))
	}
	operations := []interface{}{}
	for i := uint64(0); i < final.ObjectCount; i++ {
		operations = append(operations, map[string]interface{}{"objectId": fmt.Sprintf("migration-object-%d", i), "baseVersion": "0", "deleted": i == 0, "fields": []interface{}{map[string]interface{}{"slot": uint64(0), "nonce": bytes.Repeat([]byte{1}, 24), "ciphertext": bytes.Repeat([]byte{2}, 32)}}})
	}
	batch := map[string]interface{}{"schema": uint64(2), "vaultId": "migration-vault", "deviceId": "migration-owner", "epoch": final.TargetEpoch, "membershipRevision": uint64(0), "keyGeneration": uint64(1), "counter": "1", "mutationId": "migration-batch", "operations": operations}
	raw := signed(t, key, "mutation", batch)
	receipt, e := store.MigrationPush(ctx, uid, raw)
	if e != nil {
		t.Fatal("stage upload", e)
	}
	if again, e := store.MigrationPush(ctx, uid, raw); e != nil || again.Seq != receipt.Seq {
		t.Fatal("stage retry", e)
	}
	if _, e = store.SignedSnapshot(ctx, uid, read("snapshot", map[string]interface{}{})); !errors.Is(e, ErrInactive) {
		t.Fatal("staging leaked through active read", e)
	}
	stage, e := store.MigrationSnapshot(ctx, uid, read("migration-snapshot", map[string]interface{}{}))
	if e != nil || stage.Count != final.ObjectCount {
		t.Fatal("staged snapshot", stage, e)
	}
	page, e := store.MigrationSnapshotPage(ctx, uid, read("migration-snapshot-page", map[string]interface{}{"snapshotId": stage.ID, "after": ""}))
	if e != nil || uint64(len(page.Objects)) != final.ObjectCount || !page.Objects[0].Deleted || !bytes.Equal(page.Objects[0].Record, raw) {
		t.Fatal("staged provenance", e)
	}
	commit := map[string]interface{}{"migrationId": final.ID, "freezeSeq": final.FreezeSeq, "targetEpoch": final.TargetEpoch, "ciphertextManifest": stage.Digest}
	if _, e = store.CommitMigration(ctx, uid, control("commit", commit)); !errors.Is(e, ErrConflict) {
		t.Fatal("commit without readback", e)
	}
	attestation := map[string]interface{}{"migrationId": final.ID, "snapshotId": stage.ID, "freezeSeq": final.FreezeSeq, "ciphertextManifest": stage.Digest, "sourcePageCount": final.PageCount, "sourceObjectCount": final.ObjectCount + 1}
	if _, e = store.VerifyMigration(ctx, uid, control("verify", attestation)); !errors.Is(e, ErrConflict) {
		t.Fatal("wrong source count", e)
	}
	attestation["sourceObjectCount"] = final.ObjectCount
	verified, e := store.VerifyMigration(ctx, uid, control("verify", attestation))
	if e != nil || verified.Phase != "VERIFIED" {
		t.Fatal("readback attestation", e)
	}
	batch["counter"] = "2"
	batch["mutationId"] = "late-upload"
	if _, e = store.MigrationPush(ctx, uid, signed(t, key, "mutation", batch)); !errors.Is(e, ErrConflict) {
		t.Fatal("upload after seal", e)
	}
	if _, e = store.MigrationPush(ctx, uid, raw); e != nil {
		t.Fatal("sealed exact retry", e)
	}
	if _, e = db.ExecContext(ctx, `CREATE TRIGGER fail_migration_activation BEFORE UPDATE ON vaults FOR EACH ROW BEGIN IF NEW.mode='active' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic activation failure'; END IF; END`); e != nil {
		t.Fatal(e)
	}
	if _, e = store.CommitMigration(ctx, uid, control("commit", commit)); e == nil {
		t.Fatal("injected activation failure ignored")
	}
	if _, e = db.ExecContext(ctx, "DROP TRIGGER fail_migration_activation"); e != nil {
		t.Fatal(e)
	}
	if e = db.QueryRowContext(ctx, "SELECT mode FROM sync_users WHERE id=?", user).Scan(&mode); e != nil || mode != "e2ee_frozen" {
		t.Fatal("partial active account", e)
	}
	activated, e := store.CommitMigration(ctx, uid, control("commit", commit))
	if e != nil || activated.Phase != "ACTIVE" || activated.CiphertextManifest != stage.Digest {
		t.Fatal("activation", e)
	}
	if again, e := store.CommitMigration(ctx, uid, control("commit", commit)); e != nil || again != activated {
		t.Fatal("lost commit ACK retry", e)
	}
	if _, e = store.CancelMigration(ctx, uid, control("cancel", map[string]interface{}{"migrationId": final.ID})); !errors.Is(e, ErrConflict) {
		t.Fatal("active cancellation allowed", e)
	}
	if _, e = source.Apply(ctx, uid, mutation()); canonical.ErrorCode(e) != "UPDATE_REQUIRED" {
		t.Fatal("v2 reopened after activation", e)
	}
	if current, e := store.SignedSnapshot(ctx, uid, read("snapshot", map[string]interface{}{})); e != nil || current.Count != stage.Count {
		t.Fatal("activated snapshot", e)
	}
	if e = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM tasks WHERE user_id=?", user).Scan(&count); e != nil || uint64(count) != final.ObjectCount {
		t.Fatal("source deleted at activation", e)
	}
}
