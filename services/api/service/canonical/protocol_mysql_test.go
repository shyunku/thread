package canonical

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"os"
	"strings"
	"testing"
	"thread_api/service/database/migrations"
	"time"
)

func TestMySQLSyncProtocol(t *testing.T) {
	dsn := os.Getenv("THREAD_SYNC_TEST_DSN")
	if dsn == "" {
		t.Skip("explicit empty thread_sync_test_* DB required")
	}
	cfg, e := mysql.ParseDSN(dsn)
	if e != nil || !strings.HasPrefix(cfg.DBName, "thread_sync_test_") {
		t.Fatal("unsafe test DB")
	}
	db, e := sql.Open("mysql", dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	var count int
	if e = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()").Scan(&count); e != nil || count != 0 {
		t.Fatal("empty DB required", e)
	}
	exec := func(q string, args ...interface{}) {
		t.Helper()
		if _, e := db.ExecContext(ctx, q, args...); e != nil {
			t.Fatal(e)
		}
	}
	exec("CREATE TABLE user_master(uid VARCHAR(255) PRIMARY KEY) ENGINE=InnoDB")
	exec("CREATE TABLE transactions(txid INT,version INT,type BIGINT,`from` VARCHAR(255),timestamp BIGINT,content BLOB,hash VARCHAR(255)) ENGINE=InnoDB")
	exec("CREATE TABLE blocks(uid VARCHAR(255),block_number BIGINT,state LONGBLOB,transitions LONGBLOB,tx_hash VARCHAR(255),block_hash VARCHAR(255),prev_block_hash VARCHAR(255)) ENGINE=InnoDB")
	if _, e = migrations.Run(ctx, db, migrations.Server); e != nil {
		t.Fatal(e)
	}
	now := time.Now()
	p := Protocol{Store: &Store{DB: db, Now: func() time.Time { return now }}, Key: []byte(strings.Repeat("k", 32)), Enabled: true}
	uid, epoch, device := "fixture-sync", uuid.NewString(), uuid.NewString()
	exec("INSERT INTO sync_users(uid,mode,epoch) VALUES (?,'v2',?)", uid, epoch)
	if e = p.RegisterDevice(ctx, uid, epoch, device); e != nil {
		t.Fatal(e)
	}
	if e = p.RegisterDevice(ctx, uid, epoch, device); e != nil {
		t.Fatal(e)
	}
	apply := func(id, title string) Mutation {
		t.Helper()
		m := Mutation{Epoch: epoch, DeviceID: device, ClientChangeID: uuid.NewString(), EntityType: "task", EntityID: id, Operation: "create", BaseVersion: "0", Changes: map[string]interface{}{"title": title}}
		r, e := p.Store.Apply(ctx, uid, m)
		if e != nil || r.Status != "accepted" {
			t.Fatal(r, e)
		}
		return m
	}
	m := apply("first", "before snapshot")
	s, e := p.Snapshot(ctx, uid, epoch)
	if e != nil {
		t.Fatal(e)
	}
	if s.Seq != "1" || s.PageCount != 1 {
		t.Fatal(s)
	}
	original, e := p.SnapshotPage(ctx, uid, epoch, s.ID, 0)
	if e != nil {
		t.Fatal(e)
	}
	digest := sha256.Sum256([]byte(original.Payload))
	if hex.EncodeToString(digest[:]) != original.Checksum {
		t.Fatal("checksum")
	}
	var payload struct{ Changes []Change }
	if json.Unmarshal([]byte(original.Payload), &payload) != nil || len(payload.Changes) != 1 || payload.Changes[0].Fields["title"] != "before snapshot" {
		t.Fatal("snapshot shape")
	}
	apply("second", "after snapshot")
	apply("third", "third")
	page, e := p.Pull(ctx, uid, epoch, s.Cursor, "", 1)
	if e != nil || len(page.Entries) != 1 || page.Entries[0].Seq != "2" || !page.HasMore || page.HighWatermark != "3" {
		t.Fatal(page, e)
	}
	apply("fourth", "outside fixed highwater")
	next, e := p.Pull(ctx, uid, epoch, page.NextCursor, page.Until, 1)
	if e != nil || next.HasMore || len(next.Entries) != 1 || next.Entries[0].Seq != "3" {
		t.Fatal(next, e)
	}
	final, e := p.Pull(ctx, uid, epoch, next.NextCursor, "", 1)
	if e != nil || final.Entries[0].Seq != "4" {
		t.Fatal(final, e)
	}
	duplicate, e := p.Store.Apply(ctx, uid, m)
	if e != nil || !duplicate.Duplicate || duplicate.Seq != "1" {
		t.Fatal("lost ACK retry", duplicate, e)
	}
	after, e := p.SnapshotPage(ctx, uid, epoch, s.ID, 0)
	if e != nil || after.Payload != original.Payload {
		t.Fatal("snapshot mutated", e)
	}
	if _, e = p.Prune(ctx, uid, 4); ErrorCode(e) != "PRUNE_DISABLED" {
		t.Fatal(e)
	}
	p.PruneEnabled = true
	if n, e := p.Prune(ctx, uid, 4); e != nil || n != 1 {
		t.Fatal("snapshot pin", n, e)
	}
	if _, e = p.Pull(ctx, uid, epoch, p.Cursor(uid, epoch, "0"), "", 5); ErrorCode(e) != "RESET_REQUIRED" {
		t.Fatal("stale cursor", e)
	}
	if _, e = p.Pull(ctx, uid, epoch, s.Cursor, "", 5); e != nil {
		t.Fatal("pin suffix", e)
	}
	if _, e = p.SnapshotPage(ctx, "other", epoch, s.ID, 0); e == nil {
		t.Fatal("cross user snapshot")
	}
	if _, e = p.Pull(ctx, uid, epoch, p.Cursor("other", epoch, "1"), "", 5); ErrorCode(e) != "CURSOR_FORBIDDEN" {
		t.Fatal(e)
	}
	now = now.Add(16 * time.Minute)
	if _, e = p.SnapshotPage(ctx, uid, epoch, s.ID, 0); ErrorCode(e) != "SNAPSHOT_EXPIRED" {
		t.Fatal(e)
	}
	if n, e := p.Prune(ctx, uid, 4); e != nil || n != 4 {
		t.Fatal(n, e)
	}
	duplicate, e = p.Store.Apply(ctx, uid, m)
	if e != nil || !duplicate.Duplicate {
		t.Fatal("receipt pruned", e)
	}
	if _, e = p.Pull(ctx, uid, epoch, s.Cursor, "", 5); ErrorCode(e) != "RESET_REQUIRED" {
		t.Fatal(e)
	}
	p.Enabled = false
	if _, e = p.Pull(ctx, uid, epoch, final.NextCursor, "", 5); ErrorCode(e) != "SYNC_DISABLED" {
		t.Fatal(e)
	}
	a, e := p.Account(ctx, uid)
	if e != nil || a.Mode != "v2" {
		t.Fatal("fallback", a, e)
	}
	p.Enabled = true
	exec("UPDATE sync_devices SET revoked_at=1 WHERE device_id=?", device)
	if e = p.RegisterDevice(ctx, uid, epoch, device); ErrorCode(e) != "DEVICE_REVOKED" {
		t.Fatal(e)
	}
	called := false
	if _, e = WithLegacyFence(ctx, db, uid, func() (interface{}, error) { called = true; return nil, nil }); ErrorCode(e) != "UPDATE_REQUIRED" || called {
		t.Fatal("legacy fence", e)
	}
	if _, e = WithLegacyFence(ctx, db, "legacy", func() (interface{}, error) { called = true; return nil, nil }); e != nil || !called {
		t.Fatal(e)
	}
	// A cutover must wait until a running legacy callback releases the row.
	entered, release, finished := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	go func() {
		_, e := WithLegacyFence(ctx, db, "legacy", func() (interface{}, error) { close(entered); <-release; return nil, nil })
		finished <- e
	}()
	<-entered
	switched := make(chan error, 1)
	go func() {
		_, e := db.ExecContext(ctx, "UPDATE sync_users SET mode='v2',epoch=? WHERE uid='legacy'", epoch)
		switched <- e
	}()
	select {
	case e := <-switched:
		t.Fatal("cutover raced legacy", e)
	case <-time.After(100 * time.Millisecond):
	}
	close(release)
	if e := <-finished; e != nil {
		t.Fatal(e)
	}
	if e := <-switched; e != nil {
		t.Fatal(e)
	}
	// A physical gap must not be returned as an empty successful page.
	exec("INSERT INTO user_master VALUES ('proof-user')")
	exec("INSERT INTO sync_users(uid,mode,epoch) VALUES ('proof-user','v2',?)", epoch)
	legacyState := `{"tasks":{},"categories":{}}`
	exec("INSERT INTO transactions(txid,version,type,`from`,timestamp,content,hash) VALUES (1,2,0,'proof-user',1,?,'proof-tx')", legacyState)
	exec("INSERT INTO blocks(uid,block_number,state,block_hash,tx_hash) VALUES ('proof-user',1,?,'proof-block','proof-tx')", legacyState)
	proof, e := p.LegacyProof(ctx, "proof-user", epoch, "1")
	if e != nil || proof.BaseNumber != "1" || len(proof.Blocks) != 1 || proof.BaseRows == nil || len(proof.BaseRows.Tasks) != 0 {
		t.Fatal("legacy proof", proof, e)
	}
	if _, e = p.LegacyProof(ctx, "proof-user", epoch, "2"); ErrorCode(e) != "INVALID_LEGACY_BASE" {
		t.Fatal(e)
	}
	exec("UPDATE sync_devices SET revoked_at=NULL WHERE device_id=?", device)
	apply("fifth", "gap")
	exec("DELETE FROM sync_change_log WHERE seq=5")
	if _, e = p.Pull(ctx, uid, epoch, final.NextCursor, "", 5); ErrorCode(e) != "LOG_GAP" {
		t.Fatal(e)
	}
}
