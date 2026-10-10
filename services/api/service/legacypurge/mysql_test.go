package legacypurge

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"strings"
	"testing"
	"thread_api/service/database/migrations"
	"time"

	"github.com/go-sql-driver/mysql"
)

// Two synthetic accounts: fixture-a finished moving to E2EE, fixture-b still uses v2.
// Every plaintext table gets a row for each, so a purge of A must leave B untouched.
func fixture(t *testing.T) (*sql.DB, context.Context) {
	dsn := os.Getenv("THREAD_PURGE_TEST_DSN")
	if dsn == "" {
		t.Skip("requires empty thread_purge_test_* database")
	}
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil || !strings.HasPrefix(cfg.DBName, "thread_purge_test_") {
		t.Fatal("isolated database required")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	t.Cleanup(cancel)
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
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	// Vault devices and membership events are not part of this test.
	statements := []string{"SET FOREIGN_KEY_CHECKS=0",
		"INSERT INTO user_master VALUES('fixture-a'),('fixture-b')",
		"INSERT INTO sync_users(id,uid,mode) VALUES(1,'fixture-a','e2ee'),(2,'fixture-b','v2')",
		"INSERT INTO vaults(vault_id,account_id,mode,epoch,suite,genesis_digest,membership_head,recovery_public_key) VALUES('vault-a','fixture-a','active','1','fixture',REPEAT('a',32),REPEAT('b',32),REPEAT('c',32))",
		"INSERT INTO vault_migrations(migration_id,vault_id,source_user,coordinator,source_epoch,source_snapshot,freeze_seq,prior_vault_epoch,target_epoch,phase,page_count,object_count,created_at) VALUES" +
			"('cancelled-a','vault-a',1,'device-a',REPEAT('0',36),REPEAT('0',36),1,'0',REPEAT('1',36),'CANCELLED',1,1,1)," +
			"('migration-a','vault-a',1,'device-a',REPEAT('0',36),REPEAT('0',36),1,'0',REPEAT('1',36),'ACTIVE',1,1,2)",
		"INSERT INTO vault_migration_source_pages(migration_id,page_number,payload,checksum) VALUES('cancelled-a',0,'SYNTHETIC_PRIVATE_A',REPEAT('a',64)),('migration-a',0,'SYNTHETIC_PRIVATE_A',REPEAT('a',64))",
		"INSERT INTO transactions(txid,version,type,`from`,timestamp,content,hash) VALUES(1,1,0,'fixture-a',1,'SYNTHETIC_PRIVATE_A','h'),(2,1,0,'fixture-b',1,'OTHER_PRIVATE_B','h')",
		"INSERT INTO blocks(uid,block_number,state,transitions,tx_hash,block_hash) VALUES('fixture-a',1,'SYNTHETIC_PRIVATE_A','t','h','b'),('fixture-b',1,'OTHER_PRIVATE_B','t','h','b')",
		"SET FOREIGN_KEY_CHECKS=1",
	}
	for _, user := range []string{"1", "2"} {
		statements = append(statements,
			"INSERT INTO tasks(user_id,id,title,memo,done,done_at,due_date,repeat_period,repeat_start_at,recurrence_generation,sort_rank,created_at,updated_at,deleted_at,version,field_versions) VALUES("+user+",'task','PRIVATE','memo',0,0,0,'none',0,0,0,1,1,NULL,1,'{}')",
			"INSERT INTO categories(user_id,id,title,secret,locked,color,created_at,updated_at,deleted_at,version,field_versions) VALUES("+user+",'category','PRIVATE',0,0,'#fff',1,1,NULL,1,'{}')",
			"INSERT INTO subtasks(user_id,task_id,id,title,done,done_at,due_date,created_at,updated_at,deleted_at,version,field_versions) VALUES("+user+",'task','subtask','PRIVATE',0,0,0,1,1,NULL,1,'{}')",
			"INSERT INTO task_categories(user_id,task_id,category_id,present,updated_at,version) VALUES("+user+",'task','category',1,1,1)",
			"INSERT INTO sync_occurrences(user_id,task_id,generation,result) VALUES("+user+",'task',1,JSON_OBJECT('title','PRIVATE'))",
			"INSERT INTO sync_devices(user_id,device_id,last_seen_at) VALUES("+user+",REPEAT('d',36),1)",
			"INSERT INTO sync_receipts(user_id,device_id,client_change_id,request_hash,result,created_at) VALUES("+user+",REPEAT('d',36),REPEAT('c',36),REPEAT('h',64),JSON_OBJECT('title','PRIVATE'),1)",
			"INSERT INTO sync_change_log(user_id,seq,epoch,device_id,client_change_id,payload,created_at) VALUES("+user+",1,REPEAT('e',36),REPEAT('d',36),REPEAT('c',36),JSON_OBJECT('title','PRIVATE'),1)",
			"INSERT INTO sync_snapshots(user_id,id,epoch,seq,page_count,expires_at) VALUES("+user+",REPEAT('s',36),REPEAT('e',36),1,1,1)",
			"INSERT INTO sync_snapshot_pages(user_id,snapshot_id,page_number,payload,checksum) VALUES("+user+",REPEAT('s',36),0,'PRIVATE',REPEAT('a',64))",
		)
	}
	for _, query := range statements {
		if _, err = conn.ExecContext(ctx, query); err != nil {
			t.Fatal(query, err)
		}
	}
	return db, ctx
}

func rows(t *testing.T, ctx context.Context, db *sql.DB, query string, args ...interface{}) int64 {
	var n int64
	if err := db.QueryRowContext(ctx, query, args...).Scan(&n); err != nil {
		t.Fatal(query, err)
	}
	return n
}

func TestMySQLPurge(t *testing.T) {
	db, ctx := fixture(t)
	if _, err := DryRun(ctx, db, "fixture-b"); !errors.Is(err, ErrAccountNotDone) {
		t.Fatal("v2 account accepted", err)
	}
	if _, err := DryRun(ctx, db, "unknown"); !errors.Is(err, ErrAccountNotDone) {
		t.Fatal("unknown account accepted", err)
	}
	// Another migration still in progress blocks the purge.
	for _, phase := range []string{"COMMITTING", "CANCELLED"} {
		if _, err := db.ExecContext(ctx, "UPDATE vault_migrations SET phase=? WHERE migration_id='cancelled-a'", phase); err != nil {
			t.Fatal(err)
		}
		if _, err := DryRun(ctx, db, "fixture-a"); phase == "COMMITTING" && !errors.Is(err, ErrAccountNotDone) {
			t.Fatal("unfinished migration accepted", err)
		}
	}
	plan, err := DryRun(ctx, db, "fixture-a")
	if err != nil || plan.MigrationID != "migration-a" || len(plan.Counts) != len(targets) {
		t.Fatal("plan", plan, err)
	}
	for _, c := range plan.Counts {
		want := int64(1)
		if c.Source == "vault_migration_source_pages" {
			want = 2 // the cancelled attempt's copy too
		}
		if c.Rows != want {
			t.Fatal("count", c)
		}
	}
	changed := Plan{MigrationID: plan.MigrationID, Counts: append([]Count(nil), plan.Counts...)}
	changed.Counts[3].Rows = 2
	if _, err = Purge(ctx, db, "fixture-a", changed); !errors.Is(err, ErrPlanChanged) {
		t.Fatal("changed plan accepted", err)
	}
	if rows(t, ctx, db, "SELECT COUNT(*) FROM tasks WHERE user_id=1") != 1 {
		t.Fatal("rejected purge deleted rows")
	}
	if _, err = Purge(ctx, db, "fixture-a", plan); err != nil {
		t.Fatal("purge", err)
	}
	for _, table := range []string{"tasks", "categories", "subtasks", "task_categories", "sync_occurrences", "sync_receipts", "sync_change_log", "sync_snapshots", "sync_snapshot_pages"} {
		if rows(t, ctx, db, "SELECT COUNT(*) FROM "+table+" WHERE user_id=1") != 0 || rows(t, ctx, db, "SELECT COUNT(*) FROM "+table+" WHERE user_id=2") != 1 {
			t.Fatal("scope", table)
		}
	}
	if rows(t, ctx, db, "SELECT COUNT(*) FROM vault_migration_source_pages") != 0 ||
		rows(t, ctx, db, "SELECT COUNT(*) FROM blocks WHERE uid='fixture-a'")+rows(t, ctx, db, "SELECT COUNT(*) FROM transactions WHERE `from`='fixture-a'") != 0 ||
		rows(t, ctx, db, "SELECT COUNT(*) FROM blocks WHERE uid='fixture-b'")+rows(t, ctx, db, "SELECT COUNT(*) FROM transactions WHERE `from`='fixture-b'") != 2 {
		t.Fatal("legacy scope")
	}
	// Login, devices, vault and migration records stay.
	if rows(t, ctx, db, "SELECT COUNT(*) FROM user_master")+rows(t, ctx, db, "SELECT COUNT(*) FROM sync_users") != 4 ||
		rows(t, ctx, db, "SELECT COUNT(*) FROM sync_devices") != 2 || rows(t, ctx, db, "SELECT COUNT(*) FROM vault_migrations") != 2 ||
		rows(t, ctx, db, "SELECT COUNT(*) FROM vaults") != 1 {
		t.Fatal("kept records changed")
	}
	// Running the same plan again finds nothing left and refuses.
	if _, err = Purge(ctx, db, "fixture-a", plan); !errors.Is(err, ErrPlanChanged) {
		t.Fatal("second purge", err)
	}
	again, err := DryRun(ctx, db, "fixture-a")
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range again.Counts {
		if c.Rows != 0 {
			t.Fatal("left", c)
		}
	}
}
