package legacyinventory

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"thread_api/service/database/migrations"
	"time"

	"github.com/go-sql-driver/mysql"
)

func TestMySQLInventory(t *testing.T) {
	dsn := os.Getenv("THREAD_INVENTORY_TEST_DSN")
	if dsn == "" {
		t.Skip("requires empty thread_inventory_test_* database")
	}
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil || !strings.HasPrefix(cfg.DBName, "thread_inventory_test_") {
		t.Fatal("isolated database required")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	var count int
	if err = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()").Scan(&count); err != nil || count != 0 {
		t.Fatal("empty database required")
	}
	for _, query := range []string{
		"CREATE TABLE user_master(uid VARCHAR(255) PRIMARY KEY)",
		"CREATE TABLE transactions(txid INT,version INT,type INT,`from` VARCHAR(255),timestamp BIGINT,content BLOB,hash VARCHAR(255))",
		"CREATE TABLE blocks(uid VARCHAR(255),block_number BIGINT,state LONGBLOB,transitions LONGBLOB,tx_hash VARCHAR(255),block_hash VARCHAR(255),prev_block_hash VARCHAR(255))",
	} {
		if _, err = db.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = migrations.Run(ctx, db, migrations.Server); err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{
		"INSERT INTO user_master VALUES('fixture-a'),('fixture-b')",
		"INSERT INTO sync_users(uid,mode) VALUES('fixture-a','e2ee'),('fixture-b','v2')",
		"INSERT INTO vaults(vault_id,account_id,mode,epoch,suite,genesis_digest,membership_head,recovery_public_key) VALUES('fixture-vault','fixture-a','active','1','fixture',REPEAT('a',32),REPEAT('b',32),REPEAT('c',32))",
		"INSERT INTO transactions(txid,version,type,`from`,timestamp,content,hash) VALUES(1,1,0,'fixture-a',1,'SYNTHETIC_PRIVATE_A','hash-a'),(2,1,0,'fixture-b',1,'OTHER_PRIVATE_B','hash-b')",
		"INSERT INTO blocks(uid,block_number,state,transitions,tx_hash,block_hash) VALUES('fixture-a',1,'SYNTHETIC_PRIVATE_A','transition-a','hash-a','block-a'),('fixture-b',1,'OTHER_PRIVATE_B','transition-b','hash-b','block-b')",
		"INSERT INTO tasks(user_id,id,title,memo,done,done_at,due_date,repeat_period,repeat_start_at,recurrence_generation,sort_rank,created_at,updated_at,deleted_at,version,field_versions) SELECT id,'task-a','SYNTHETIC_PRIVATE_A','memo-a',0,0,0,'none',0,0,0,1,1,NULL,1,'{}' FROM sync_users WHERE uid='fixture-a'",
		"INSERT INTO tasks(user_id,id,title,memo,done,done_at,due_date,repeat_period,repeat_start_at,recurrence_generation,sort_rank,created_at,updated_at,deleted_at,version,field_versions) SELECT id,'task-b','OTHER_PRIVATE_B','memo-b',0,0,0,'none',0,0,0,1,1,NULL,1,'{}' FROM sync_users WHERE uid='fixture-b'",
		"INSERT INTO sync_change_log(user_id,seq,epoch,device_id,client_change_id,payload,created_at) SELECT id,1,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003',JSON_OBJECT('title','SYNTHETIC_PRIVATE_A'),1 FROM sync_users WHERE uid='fixture-a'",
	} {
		if _, err = db.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	report, err := Read(ctx, db, "fixture-a")
	if err != nil || report.AccountMode != "e2ee" || report.VaultMode != "active" || !report.BackupsAndLogsNotIncluded {
		t.Fatal("account state", err)
	}
	found := map[string]Entry{}
	for _, item := range report.Sources {
		found[item.Source] = item
	}
	for _, name := range []string{"tasks", "sync_change_log", "legacy_blocks", "legacy_transactions"} {
		if found[name].Rows != 1 || found[name].PayloadBytes == 0 {
			t.Fatal("missing plaintext inventory", name, found[name])
		}
	}
	encoded, err := json.Marshal(report)
	if err != nil || bytes.Contains(encoded, []byte("SYNTHETIC_PRIVATE_A")) || bytes.Contains(encoded, []byte("OTHER_PRIVATE_B")) || bytes.Contains(encoded, []byte("fixture-a")) {
		t.Fatal("inventory output contains identity or content")
	}
	if _, err = Read(ctx, db, "unknown"); err == nil {
		t.Fatal("unknown account accepted")
	}
}
