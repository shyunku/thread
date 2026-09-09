package vault

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"database/sql"
	"errors"
	"github.com/go-sql-driver/mysql"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"thread_api/service/database/migrations"
	"time"
)

func TestMySQLSignedMembership(t *testing.T) {
	dsn := os.Getenv("THREAD_VAULT_TEST_DSN")
	if dsn == "" {
		t.Skip("requires empty thread_vault_test_* database")
	}
	cfg, e := mysql.ParseDSN(dsn)
	if e != nil || !strings.HasPrefix(cfg.DBName, "thread_vault_test_") {
		t.Fatal("disposable DB required")
	}
	db, e := sql.Open("mysql", dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	var count int
	if e = db.QueryRowContext(ctx, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()`).Scan(&count); e != nil || count != 0 {
		t.Fatal("empty disposable DB required")
	}
	for _, query := range []string{
		`CREATE TABLE user_master(uid VARCHAR(255) PRIMARY KEY) ENGINE=InnoDB`,
		"CREATE TABLE transactions(txid INT,version INT,type INT,`from` VARCHAR(255),timestamp BIGINT,content BLOB,hash VARCHAR(255)) ENGINE=InnoDB",
		`CREATE TABLE blocks(uid VARCHAR(255),block_number BIGINT,state LONGBLOB,transitions LONGBLOB,tx_hash VARCHAR(255),block_hash VARCHAR(255),prev_block_hash VARCHAR(255)) ENGINE=InnoDB`,
		`INSERT INTO user_master VALUES('fixture-user'),('other-user')`,
	} {
		if _, e = db.ExecContext(ctx, query); e != nil {
			t.Fatal(e)
		}
	}
	if _, e = migrations.Run(ctx, db, migrations.Server); e != nil {
		t.Fatal(e)
	}
	store := Store{db}
	owner, key := testDevice("owner", 3, "write", true)
	_, recoveryKey := testDevice("recovery", 8, "write", true)
	genesis := signed(t, key, "genesis", map[string]interface{}{"schema": uint64(1), "vaultId": "fixture", "recoveryKey": []byte(recoveryKey.Public().(ed25519.PublicKey)), "owner": owner})
	head, e := store.Create(ctx, "fixture-user", genesis)
	if e != nil {
		t.Fatal(e)
	}
	if duplicate, e := store.Create(ctx, "fixture-user", genesis); e != nil || duplicate != head {
		t.Fatal("identical genesis retry failed", e)
	}
	status, statusErr := store.Status(ctx, "fixture-user")
	if statusErr != nil || status.VaultID != "fixture" || status.AccountMode != "v2" || status.VaultMode != "pending" || status.Epoch != "1" || status.Revision != 0 || status.KeyGeneration != 1 || status.Head != head.Digest {
		t.Fatal("vault routing state", status, statusErr)
	}
	if _, err := store.Status(ctx, "other-user"); !errors.Is(err, ErrNotFound) {
		t.Fatal("account status isolation", err)
	}
	mobile, mobileKey := testDevice("mobile", 4, "read", false)
	event := map[string]interface{}{"vaultId": "fixture", "revision": uint64(1), "previous": head.Digest, "signer": "owner", "operation": "add", "device": mobile}
	event["expiresAt"] = uint64(time.Now().Add(time.Minute).UnixMilli())
	event["requestId"] = "fixture-approval"
	raw := signed(t, key, "membership", event)
	if _, e = store.ApplyPending(ctx, "other-user", raw); !errors.Is(e, ErrNotFound) {
		t.Fatal("cross-account mutation accepted")
	}
	tampered := append([]byte(nil), raw...)
	tampered[len(tampered)-1] ^= 1
	if _, e = store.ApplyPending(ctx, "fixture-user", tampered); e == nil {
		t.Fatal("tampering accepted")
	}
	head, e = store.ApplyPending(ctx, "fixture-user", raw)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = store.ApplyPending(ctx, "fixture-user", raw); e != nil {
		t.Fatal("exact retry failed", e)
	}
	event["device"], _ = testDevice("other", 5, "read", false)
	if _, e = store.ApplyPending(ctx, "fixture-user", signed(t, key, "membership", event)); !errors.Is(e, ErrConflict) {
		t.Fatal("fork accepted")
	}
	event["revision"] = uint64(2)
	event["previous"] = head.Digest
	event["signer"] = "mobile"
	if _, e = store.ApplyPending(ctx, "fixture-user", signed(t, mobileKey, "membership", event)); !errors.Is(e, ErrForbidden) {
		t.Fatal("read-only approval accepted")
	}
	revoke := map[string]interface{}{"vaultId": "fixture", "revision": uint64(2), "previous": head.Digest, "signer": "owner", "operation": "revoke", "deviceId": "mobile"}
	revoke["expiresAt"] = uint64(time.Now().Add(time.Minute).UnixMilli())
	revoke["requestId"] = "fixture-revoke"
	head, e = store.ApplyPending(ctx, "fixture-user", signed(t, key, "membership", revoke))
	if e != nil {
		t.Fatal(e)
	}
	revoke["revision"] = uint64(3)
	revoke["previous"] = head.Digest
	revoke["deviceId"] = "owner"
	if _, e = store.ApplyPending(ctx, "fixture-user", signed(t, key, "membership", revoke)); !errors.Is(e, ErrForbidden) {
		t.Fatal("last authority removed")
	}
	// Failed operations must not leave a membership event behind.
	if e = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM vault_membership_events").Scan(&count); e != nil || count != 3 {
		t.Fatal("partial event committed")
	}
	page, e := store.Read(ctx, "fixture-user", 0)
	if e != nil || len(page.Records) != 2 || !bytes.Equal(page.Genesis, genesis) {
		t.Fatal("original provenance missing", e)
	}
	if _, e = store.Read(ctx, "other-user", 0); !errors.Is(e, ErrNotFound) {
		t.Fatal("cross-account read accepted")
	}
	newOwner, newOwnerKey := testDevice("recovered", 9, "write", true)
	_, newRecoveryKey := testDevice("new-recovery", 10, "write", true)
	recoveryBody := map[string]interface{}{"vaultId": "fixture", "revision": uint64(3), "previous": head.Digest, "operation": "recover", "keyGeneration": uint64(2), "recoveryKey": []byte(newRecoveryKey.Public().(ed25519.PublicKey)), "devices": []interface{}{newOwner}}
	if _, e = store.RecoverPending(ctx, "fixture-user", signed(t, key, "recovery", recoveryBody)); e == nil {
		t.Fatal("device key used as recovery authority")
	}
	recoveryRaw := signed(t, recoveryKey, "recovery", recoveryBody)
	head, e = store.RecoverPending(ctx, "fixture-user", recoveryRaw)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = store.RecoverPending(ctx, "fixture-user", recoveryRaw); e != nil {
		t.Fatal("recovery retry failed", e)
	}
	readDevice, readKey := testDevice("reader", 11, "read", false)
	readBody := map[string]interface{}{"vaultId": "fixture", "revision": uint64(4), "previous": head.Digest, "signer": "recovered", "operation": "add", "device": readDevice}
	readBody["expiresAt"] = uint64(time.Now().Add(-time.Minute).UnixMilli())
	readBody["requestId"] = "fixture-reader"
	if _, e = store.ApplyPending(ctx, "fixture-user", signed(t, newOwnerKey, "membership", readBody)); !errors.Is(e, ErrInvalid) {
		t.Fatal("expired approval accepted", e)
	}
	readBody["expiresAt"] = uint64(time.Now().Add(time.Minute).UnixMilli())
	head, e = store.ApplyPending(ctx, "fixture-user", signed(t, newOwnerKey, "membership", readBody))
	if e != nil {
		t.Fatal(e)
	}
	field := map[string]interface{}{"slot": uint64(0), "nonce": bytes.Repeat([]byte{2}, 24), "ciphertext": bytes.Repeat([]byte{3}, 32)}
	op := map[string]interface{}{"objectId": "one", "baseVersion": "0", "deleted": false, "fields": []interface{}{field}}
	pushBody := map[string]interface{}{"schema": uint64(1), "vaultId": "fixture", "deviceId": "recovered", "epoch": "1", "membershipRevision": uint64(4), "keyGeneration": uint64(2), "counter": "1", "mutationId": "mutation-one", "operations": []interface{}{op}}
	pushRaw := signed(t, newOwnerKey, "mutation", pushBody)
	if _, e = store.Push(ctx, "fixture-user", pushRaw); !errors.Is(e, ErrInactive) {
		t.Fatal("pending vault allowed sync")
	}
	// Synthetic-only activation. No production activation API exists.
	if _, e = db.ExecContext(ctx, "UPDATE vaults SET mode='active' WHERE vault_id='fixture'"); e != nil {
		t.Fatal(e)
	}
	result, e := store.Push(ctx, "fixture-user", pushRaw)
	if e != nil || result.Seq != "1" || result.Versions["one"] != "1" {
		t.Fatal("push failed", e)
	}
	duplicate, e := store.Push(ctx, "fixture-user", pushRaw)
	if e != nil || duplicate.Seq != "1" {
		t.Fatal("idempotent retry failed", e)
	}
	pushBody["deviceId"] = "reader"
	pushBody["mutationId"] = "reader-write"
	if _, e = store.Push(ctx, "fixture-user", signed(t, readKey, "mutation", pushBody)); !errors.Is(e, ErrForbidden) {
		t.Fatal("reader wrote ciphertext")
	}
	pushBody["deviceId"] = "recovered"
	pushBody["counter"] = "2"
	pushBody["mutationId"] = "stale-batch"
	op2 := map[string]interface{}{"objectId": "two", "baseVersion": "0", "deleted": false, "fields": []interface{}{field}}
	pushBody["operations"] = []interface{}{op2, op}
	if _, e = store.Push(ctx, "fixture-user", signed(t, newOwnerKey, "mutation", pushBody)); !errors.Is(e, ErrObjectConflict) {
		t.Fatal("stale batch accepted", e)
	}
	if e = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM encrypted_objects").Scan(&count); e != nil || count != 1 {
		t.Fatal("partial batch committed")
	}
	pushBody["operations"] = []interface{}{op2}
	pushBody["mutationId"] = "next-batch"
	result, e = store.Push(ctx, "fixture-user", signed(t, newOwnerKey, "mutation", pushBody))
	if e != nil || result.Seq != "2" {
		t.Fatal("failed batch consumed counter", e)
	}
	if _, e = store.Push(ctx, "other-user", pushRaw); !errors.Is(e, ErrNotFound) {
		t.Fatal("cross-account sync accepted")
	}
	changes, e := store.Pull(ctx, "fixture-user", "1", 0, 0)
	if e != nil || len(changes.Changes) != 2 || changes.Next != "2" || !bytes.Equal(changes.Changes[0].Record, pushRaw) {
		t.Fatal("pull provenance", e)
	}
	snapshot, e := store.Snapshot(ctx, "fixture-user")
	if e != nil || snapshot.Count != 2 || snapshot.Seq != "2" {
		t.Fatal("snapshot", e)
	}
	op["baseVersion"] = "1"
	pushBody["operations"] = []interface{}{op}
	pushBody["counter"] = "3"
	pushBody["mutationId"] = "after-snapshot"
	if _, e = store.Push(ctx, "fixture-user", signed(t, newOwnerKey, "mutation", pushBody)); e != nil {
		t.Fatal(e)
	}
	objects, e := store.SnapshotPage(ctx, "fixture-user", snapshot.ID, "")
	if e != nil || len(objects.Objects) != 2 || objects.Objects[0].Version != "1" || !bytes.Equal(objects.Objects[0].Record, pushRaw) {
		t.Fatal("snapshot changed after mutation", e)
	}
	if _, e = store.SnapshotPage(ctx, "other-user", snapshot.ID, ""); !errors.Is(e, ErrNotFound) {
		t.Fatal("cross-account snapshot accepted")
	}
	if _, e = store.Pull(ctx, "fixture-user", "wrong-epoch", 0, 0); !errors.Is(e, ErrConflict) {
		t.Fatal("wrong epoch pull accepted")
	}
	proof := map[string]interface{}{"schema": uint64(1), "vaultId": "fixture", "deviceId": "reader", "epoch": "1", "membershipRevision": uint64(4), "keyGeneration": uint64(2), "operation": "pull", "parameters": map[string]interface{}{"after": "0", "until": "0"}, "requestId": "read-one", "expiresAt": uint64(time.Now().Add(time.Minute).UnixMilli())}
	readRaw := signed(t, readKey, "request", proof)
	if result, e := store.SignedPull(ctx, "fixture-user", readRaw); e != nil || result.Next != "3" {
		t.Fatal("approved readonly pull", e)
	}
	if _, e := store.SignedPull(ctx, "other-user", readRaw); !errors.Is(e, ErrForbidden) {
		t.Fatal("cross account read proof", e)
	}
	proof["deviceId"] = "mobile"
	if _, e := store.SignedPull(ctx, "fixture-user", signed(t, mobileKey, "request", proof)); !errors.Is(e, ErrForbidden) {
		t.Fatal("revoked device read", e)
	}
	proof["deviceId"] = "reader"
	proof["expiresAt"] = uint64(time.Now().Add(-time.Minute).UnixMilli())
	if _, e := store.SignedPull(ctx, "fixture-user", signed(t, readKey, "request", proof)); !errors.Is(e, ErrInvalid) {
		t.Fatal("expired read", e)
	}
	proof["expiresAt"] = uint64(time.Now().Add(time.Minute).UnixMilli())
	proof["membershipRevision"] = "4"
	if _, e := store.SignedPull(ctx, "fixture-user", signed(t, readKey, "request", proof)); !errors.Is(e, ErrInvalid) {
		t.Fatal("incorrect revision type", e)
	}
	proof["membershipRevision"] = uint64(3)
	if _, e := store.SignedPull(ctx, "fixture-user", signed(t, readKey, "request", proof)); !errors.Is(e, ErrConflict) {
		t.Fatal("stale membership proof", e)
	}
	proof["membershipRevision"] = uint64(4)
	if _, e := store.SignedSnapshot(ctx, "fixture-user", signed(t, readKey, "request", proof)); !errors.Is(e, ErrInvalid) {
		t.Fatal("request method substitution", e)
	}
	proof["operation"] = "snapshot-page"
	proof["parameters"] = map[string]interface{}{"snapshotId": snapshot.ID, "after": ""}
	if result, e := store.SignedSnapshotPage(ctx, "fixture-user", signed(t, readKey, "request", proof)); e != nil || len(result.Objects) != 2 {
		t.Fatal("signed snapshot read", e)
	}
	proof["operation"] = "snapshot"
	proof["parameters"] = map[string]interface{}{}
	one, e := store.SignedSnapshot(ctx, "fixture-user", signed(t, readKey, "request", proof))
	if e != nil {
		t.Fatal(e)
	}
	two, e := store.SignedSnapshot(ctx, "fixture-user", signed(t, readKey, "request", proof))
	if e != nil || one.ID != two.ID {
		t.Fatal("snapshot retry allocated a copy", e)
	}
	for counter := 4; counter <= 6; counter++ {
		op["baseVersion"] = strconv.Itoa(counter - 2)
		pushBody["counter"] = strconv.Itoa(counter)
		pushBody["mutationId"] = "quota-" + strconv.Itoa(counter)
		if _, e = store.Push(ctx, "fixture-user", signed(t, newOwnerKey, "mutation", pushBody)); e != nil {
			t.Fatal(e)
		}
		_, e = store.Snapshot(ctx, "fixture-user")
		if counter < 6 && e != nil {
			t.Fatal(e)
		}
		if counter == 6 && !errors.Is(e, ErrQuota) {
			t.Fatal("snapshot quota missing", e)
		}
	}
	if _, e = db.ExecContext(ctx, "UPDATE encrypted_snapshots SET expires_at=1"); e != nil {
		t.Fatal(e)
	}
	if _, e = store.Snapshot(ctx, "fixture-user"); e != nil {
		t.Fatal("expired snapshot cleanup failed", e)
	}
	if e = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM encrypted_snapshots").Scan(&count); e != nil || count != 1 {
		t.Fatal("expired snapshots retained", e)
	}
	// Competing offline writes to one base version: exactly one atomic winner.
	op["baseVersion"] = "5"
	pushBody["counter"] = "7"
	pushBody["mutationId"] = "race-first"
	first := signed(t, newOwnerKey, "mutation", pushBody)
	pushBody["counter"] = "8"
	pushBody["mutationId"] = "race-second"
	second := signed(t, newOwnerKey, "mutation", pushBody)
	var group sync.WaitGroup
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, raw := range [][]byte{first, second} {
		group.Add(1)
		go func(raw []byte) {
			defer group.Done()
			<-start
			_, err := store.Push(ctx, "fixture-user", raw)
			results <- err
		}(raw)
	}
	close(start)
	group.Wait()
	close(results)
	accepted := 0
	for err := range results {
		if err == nil {
			accepted++
		} else if !errors.Is(err, ErrConflict) && !errors.Is(err, ErrObjectConflict) {
			t.Fatal(err)
		}
	}
	if accepted != 1 {
		t.Fatal("concurrent CAS accepted", accepted)
	}
	if e = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM encrypted_changes").Scan(&count); e != nil || count != 7 {
		t.Fatal("concurrent partial commit", e)
	}
	_, rotatedAuthority := testDevice("rotated-authority", 12, "write", true)
	transition := map[string]interface{}{"schema": uint64(1), "vaultId": "fixture", "revision": uint64(5), "previous": head.Digest, "operation": "rotate", "signer": "recovered", "keyGeneration": uint64(3), "recoveryKey": []byte(rotatedAuthority.Public().(ed25519.PublicKey)), "devices": []interface{}{newOwner}, "envelopes": []interface{}{map[string]interface{}{"deviceId": "recovered", "ciphertext": bytes.Repeat([]byte{5}, 48)}}, "recoveryEnvelope": bytes.Repeat([]byte{6}, 48)}
	transition["signer"] = "reader"
	if _, e = store.ApplyTransition(ctx, "fixture-user", signed(t, readKey, "membership-transition", transition)); !errors.Is(e, ErrForbidden) {
		t.Fatal("readonly key rotation", e)
	}
	transition["signer"] = "recovered"
	validEnvelopes := transition["envelopes"]
	transition["envelopes"] = []interface{}{}
	if _, e = store.ApplyTransition(ctx, "fixture-user", signed(t, newOwnerKey, "membership-transition", transition)); !errors.Is(e, ErrInvalid) {
		t.Fatal("incomplete recipient set", e)
	}
	transition["envelopes"] = validEnvelopes
	transitionRaw := signed(t, newOwnerKey, "membership-transition", transition)
	head, e = store.ApplyTransition(ctx, "fixture-user", transitionRaw)
	if e != nil {
		t.Fatal("active rotation", e)
	}
	if retry, e := store.ApplyTransition(ctx, "fixture-user", transitionRaw); e != nil || retry != head {
		t.Fatal("rotation retry", e)
	}
	proof["operation"] = "pull"
	proof["parameters"] = map[string]interface{}{"after": "0", "until": "0"}
	if _, e = store.SignedPull(ctx, "fixture-user", signed(t, readKey, "request", proof)); !errors.Is(e, ErrForbidden) {
		t.Fatal("revoked reader can sync", e)
	}
	proof["deviceId"] = "recovered"
	proof["membershipRevision"] = uint64(5)
	proof["keyGeneration"] = uint64(3)
	proof["operation"] = "envelope"
	proof["parameters"] = map[string]interface{}{"keyGeneration": uint64(3)}
	if envelope, e := store.SignedEnvelope(ctx, "fixture-user", signed(t, newOwnerKey, "request", proof)); e != nil || !bytes.Equal(envelope.Record, transitionRaw) {
		t.Fatal("recipient envelope delivery", e)
	}
	pushBody["counter"] = "9"
	pushBody["mutationId"] = "obsolete-key"
	op["baseVersion"] = "6"
	if _, e = store.Push(ctx, "fixture-user", signed(t, newOwnerKey, "mutation", pushBody)); !errors.Is(e, ErrConflict) {
		t.Fatal("old generation write", e)
	}
	fresh, _ := testDevice("fresh-after-loss", 13, "write", true)
	_, finalAuthority := testDevice("final-authority", 14, "write", true)
	transition["operation"] = "recover"
	transition["signer"] = nil
	transition["revision"] = uint64(6)
	transition["previous"] = head.Digest
	transition["keyGeneration"] = uint64(4)
	transition["recoveryKey"] = []byte(finalAuthority.Public().(ed25519.PublicKey))
	transition["devices"] = []interface{}{fresh}
	transition["envelopes"] = []interface{}{map[string]interface{}{"deviceId": "fresh-after-loss", "ciphertext": bytes.Repeat([]byte{8}, 48)}}
	if _, e = store.ApplyTransition(ctx, "fixture-user", signed(t, newRecoveryKey, "recovery-transition", transition)); e == nil {
		t.Fatal("old recovery authority accepted")
	}
	if _, e = store.ApplyTransition(ctx, "fixture-user", signed(t, rotatedAuthority, "recovery-transition", transition)); e != nil {
		t.Fatal("all-device-loss recovery", e)
	}
	if _, e = store.SignedEnvelope(ctx, "fixture-user", signed(t, newOwnerKey, "request", proof)); !errors.Is(e, ErrForbidden) {
		t.Fatal("replaced device can read envelopes", e)
	}
	if e = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM vault_membership_events").Scan(&count); e != nil || count != 7 {
		t.Fatal("partial rotation event", e)
	}
	testMigrationFreeze(t, db)
	testMigrationCancellation(t, db)
}
