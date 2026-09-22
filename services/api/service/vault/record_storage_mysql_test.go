package vault

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"os"
	"strings"
	"testing"
	"thread_api/service/database/migrations"
	"time"
)

// Isolated DB only: verifies legacy BLOB preservation and measures new refs.
func TestMySQLRecordStorageMigration(t *testing.T) {
	dsn := os.Getenv("THREAD_RECORD_TEST_DSN")
	if dsn == "" {
		t.Skip("requires empty thread_record_test_* database")
	}
	cfg, e := mysql.ParseDSN(dsn)
	if e != nil || !strings.HasPrefix(cfg.DBName, "thread_record_test_") {
		t.Fatal("isolated DB required")
	}
	db, e := sql.Open("mysql", dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	var count int
	if e = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()").Scan(&count); e != nil || count != 0 {
		t.Fatal("empty DB required")
	}
	for _, q := range []string{"CREATE TABLE user_master(uid VARCHAR(255) PRIMARY KEY)", "CREATE TABLE transactions(txid INT,version INT,type INT,`from` VARCHAR(255),timestamp BIGINT,content BLOB,hash VARCHAR(255))", "CREATE TABLE blocks(uid VARCHAR(255),block_number BIGINT,state LONGBLOB,transitions LONGBLOB,tx_hash VARCHAR(255),block_hash VARCHAR(255),prev_block_hash VARCHAR(255))"} {
		if _, e = db.ExecContext(ctx, q); e != nil {
			t.Fatal(e)
		}
	}
	if _, e = migrations.Run(ctx, db, migrations.Server[:10]); e != nil {
		t.Fatal(e)
	}
	if _, e = db.ExecContext(ctx, `INSERT INTO vaults(vault_id,account_id,mode,epoch,suite,genesis_digest,membership_head,recovery_public_key) VALUES('storage','synthetic','active','1','fixture',REPEAT('a',32),REPEAT('b',32),REPEAT('c',32))`); e != nil {
		t.Fatal(e)
	}
	_, key, _ := ed25519.GenerateKey(nil)
	makeBatch := func(base int) []byte {
		ops := []interface{}{}
		for i := 0; i < 100; i++ {
			ops = append(ops, map[string]interface{}{"objectId": fmt.Sprintf("object-%06d", base+i), "baseVersion": "0", "deleted": false, "fields": []interface{}{map[string]interface{}{"slot": uint64(0), "nonce": bytes.Repeat([]byte{2}, 24), "ciphertext": bytes.Repeat([]byte{3}, 128)}}})
		}
		return signed(t, key, "mutation", map[string]interface{}{"schema": uint64(2), "vaultId": "storage", "deviceId": "fixture", "epoch": "1", "membershipRevision": uint64(0), "keyGeneration": uint64(1), "counter": fmt.Sprint(base + 1), "mutationId": fmt.Sprintf("batch-%d", base), "operations": ops})
	}
	original := makeBatch(0)
	if _, e = db.ExecContext(ctx, `INSERT INTO encrypted_changes(vault_id,seq,signed_record,result) VALUES('storage',1,?,'{}')`, original); e != nil {
		t.Fatal(e)
	}
	if _, e = db.ExecContext(ctx, `INSERT INTO encrypted_snapshots(id,vault_id,epoch,seq,membership_head,manifest_digest,object_count,expires_at) VALUES('old-snapshot','storage','1',1,REPEAT('b',32),REPEAT('d',32),100,9999999999)`); e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 100; i++ {
		id := fmt.Sprintf("object-%06d", i)
		if _, e = db.ExecContext(ctx, `INSERT INTO encrypted_objects VALUES('storage',?,1,1,0,?,?)`, id, i, original); e != nil {
			t.Fatal(e)
		}
		if _, e = db.ExecContext(ctx, `INSERT INTO encrypted_snapshot_objects VALUES('old-snapshot',?,1,1,0,?,?)`, id, i, original); e != nil {
			t.Fatal(e)
		}
	}
	if _, e = migrations.Run(ctx, db, migrations.Server); e != nil {
		t.Fatal(e)
	}
	if _, e = migrations.Run(ctx, db, migrations.Server); e != nil {
		t.Fatal("repeat", e)
	}
	for _, table := range []string{"encrypted_objects", "encrypted_changes", "encrypted_snapshot_objects"} {
		var n int
		expected := 100
		if table == "encrypted_changes" {
			expected = 1
		}
		if e = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" o JOIN encrypted_records r ON r.vault_id=o.vault_id AND r.record_digest=o.record_digest WHERE o.signed_record IS NOT NULL AND o.signed_record=r.signed_record AND o.record_digest=UNHEX(SHA2(o.signed_record,256))").Scan(&n); e != nil || n != expected {
			t.Fatal("original bytes not preserved", table, e)
		}
	}
	var restored []byte
	if e = db.QueryRowContext(ctx, "SELECT signed_record FROM encrypted_records WHERE vault_id='storage'").Scan(&restored); e != nil || !bytes.Equal(restored, original) {
		t.Fatal("signed bytes changed", e)
	}
	record, e := ParseRecord(restored)
	if e != nil || record.Verify(key.Public().(ed25519.PublicKey), "mutation") != nil {
		t.Fatal("signature lost")
	}
	for _, target := range []int{1000, 10000, 100000} {
		start := time.Now()
		var existing int
		if e = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM encrypted_objects").Scan(&existing); e != nil {
			t.Fatal(e)
		}
		for base := existing; base < target; base += 100 {
			raw := makeBatch(base)
			digest := sha256.Sum256(raw)
			tx, e := db.BeginTx(ctx, nil)
			if e != nil {
				t.Fatal(e)
			}
			if _, e = tx.ExecContext(ctx, "INSERT INTO encrypted_records VALUES('storage',?,?)", digest[:], raw); e != nil {
				tx.Rollback()
				t.Fatal(e)
			}
			values := []string{}
			args := []interface{}{}
			for i := 0; i < 100; i++ {
				values = append(values, "('storage',?,1,?,0,?,?)")
				args = append(args, fmt.Sprintf("object-%06d", base+i), base/100+1, i, digest[:])
			}
			if _, e = tx.ExecContext(ctx, "INSERT INTO encrypted_objects(vault_id,object_id,version,seq,deleted,operation_index,record_digest) VALUES "+strings.Join(values, ","), args...); e != nil {
				tx.Rollback()
				t.Fatal(e)
			}
			if e = tx.Commit(); e != nil {
				t.Fatal(e)
			}
		}
		var records, shared, duplicated int64
		if e = db.QueryRowContext(ctx, "SELECT COUNT(*),SUM(OCTET_LENGTH(signed_record)) FROM encrypted_records").Scan(&records, &shared); e != nil {
			t.Fatal(e)
		}
		if e = db.QueryRowContext(ctx, "SELECT SUM(OCTET_LENGTH(r.signed_record)) FROM encrypted_objects o JOIN encrypted_records r ON r.vault_id=o.vault_id AND r.record_digest=o.record_digest").Scan(&duplicated); e != nil {
			t.Fatal(e)
		}
		if records != int64(target/100) || duplicated != shared*100 {
			t.Fatal("nonlinear duplication", records, shared, duplicated)
		}
		t.Logf("objects=%d records=%d shared_payload_bytes=%d old_duplicated_payload_bytes=%d elapsed=%s", target, records, shared, duplicated, time.Since(start))
	}
}
