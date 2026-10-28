package accountdelete

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"thread_api/service/database/migrations"
	"time"

	"github.com/go-sql-driver/mysql"
)

type fixtureAccount struct {
	uid       string
	n         int    // distinct per account, used for global keys
	user      int    // sync_users.id; 0 = none
	mode      string // sync_users.mode
	vaultMode string // "" = no vault
	phase     string // vault migration phase; "" = none
}

// Five synthetic accounts, one per account mode. Foreign keys stay on, so the
// fixture and the delete order are both checked against the real schema.
var fixtureAccounts = []fixtureAccount{
	{uid: "fixture-a", n: 1, user: 1, mode: "e2ee", vaultMode: "migrating", phase: "UPLOADING"},
	{uid: "fixture-b", n: 2, user: 2, mode: "e2ee", vaultMode: "active", phase: "ACTIVE"},
	{uid: "fixture-c", n: 3, user: 3, mode: "v2"},
	{uid: "fixture-d", n: 4, user: 4, mode: "v2", vaultMode: "pending"},
	{uid: "fixture-e", n: 5},
}

func (a fixtureAccount) statements() []string {
	u, user := a.uid, fmt.Sprint(a.user)
	q := func(format string, args ...interface{}) string { return fmt.Sprintf(format, args...) }
	list := []string{
		q("INSERT INTO user_master(uid) VALUES('%s')", u),
		q("INSERT INTO admin_master(uid) VALUES('%s')", u),
		q("INSERT INTO transactions(version,type,`from`,timestamp,content,hash) VALUES(1,0,'%s',1,'SYNTHETIC_PRIVATE','hash-%s')", u, u),
		q("INSERT INTO blocks(uid,block_hash,transitions,state,block_number,tx_hash) VALUES('%s','block-%s','SYNTHETIC','SYNTHETIC',1,'hash-%s')", u, u, u),
	}
	if a.user > 0 {
		list = append(list,
			q("INSERT INTO sync_users(id,uid,mode) VALUES(%s,'%s','%s')", user, u, a.mode),
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
			"INSERT INTO sync_backfills(user_id,source_checksum,rows_checksum,epoch,completed_at) VALUES("+user+",REPEAT('a',64),REPEAT('b',64),REPEAT('e',36),1)",
		)
	}
	if a.vaultMode != "" {
		v, snap := "vault-"+u, fmt.Sprintf("%036d", a.n)
		list = append(list,
			q("INSERT INTO vaults(vault_id,account_id,mode,epoch,suite,genesis_digest,membership_head,recovery_public_key) VALUES('%s','%s','%s','1','fixture',REPEAT('a',32),REPEAT('b',32),REPEAT('c',32))", v, u, a.vaultMode),
			q("INSERT INTO vault_membership_events(vault_id,revision,event_digest,previous_digest,signed_record) VALUES('%s',0,REPEAT('g',32),NULL,'SYNTHETIC')", v),
			q("INSERT INTO vault_devices(vault_id,device_id,signing_public_key,encryption_public_key,role,can_authorize_devices,approved_revision) VALUES('%s','device-%s',REPEAT('s',32),REPEAT('k',32),'write',1,0)", v, u),
			q("INSERT INTO vault_key_envelopes(vault_id,recipient_device_id,key_generation,membership_revision,signed_envelope) VALUES('%s','device-%s',1,0,'SYNTHETIC')", v, u),
			q("INSERT INTO vault_sync(vault_id,last_seq) VALUES('%s',1)", v),
			q("INSERT INTO encrypted_records(vault_id,record_digest,signed_record) VALUES('%s',REPEAT('r',32),'SYNTHETIC_CIPHERTEXT')", v),
			q("INSERT INTO encrypted_objects(vault_id,object_id,version,seq,deleted,operation_index,record_digest) VALUES('%s','object',1,1,0,0,REPEAT('r',32))", v),
			q("INSERT INTO encrypted_changes(vault_id,seq,result,record_digest) VALUES('%s',1,'SYNTHETIC',REPEAT('r',32))", v),
			q("INSERT INTO encrypted_receipts(vault_id,device_id,mutation_id,counter,request_digest,result) VALUES('%s','device-%s','mutation',1,REPEAT('q',32),'SYNTHETIC')", v, u),
			q("INSERT INTO encrypted_snapshots(id,vault_id,epoch,seq,membership_head,manifest_digest,object_count,expires_at) VALUES('%s','%s','1',1,REPEAT('b',32),REPEAT('m',32),1,1)", snap, v),
			q("INSERT INTO encrypted_snapshot_objects(snapshot_id,object_id,version,seq,deleted,operation_index,vault_id,record_digest) VALUES('%s','object',1,1,0,0,'%s',REPEAT('r',32))", snap, v),
		)
		if a.phase != "" {
			m := "migration-" + u
			list = append(list,
				q("INSERT INTO vault_migrations(migration_id,vault_id,source_user,coordinator,source_epoch,source_snapshot,freeze_seq,prior_vault_epoch,target_epoch,phase,page_count,object_count,created_at) VALUES('%s','%s',%s,'device-%s',REPEAT('0',36),REPEAT('0',36),1,'0',REPEAT('1',36),'%s',1,1,1)", m, v, user, u, a.phase),
				q("INSERT INTO vault_migration_active(vault_id,migration_id) VALUES('%s','%s')", v, m),
				q("INSERT INTO vault_migration_source_pages(migration_id,page_number,payload,checksum) VALUES('%s',0,'SYNTHETIC_PRIVATE',REPEAT('a',64))", m),
				q("INSERT INTO vault_migration_verifications(migration_id,snapshot_id,ciphertext_manifest,stage_seq,membership_head,key_generation,object_count,signed_attestation) VALUES('%s','%s',REPEAT('m',32),1,REPEAT('b',32),1,1,'SYNTHETIC')", m, snap),
			)
		}
	}
	return list
}

func fixture(t *testing.T) (*sql.DB, context.Context) {
	dsn := os.Getenv("THREAD_ACCOUNT_DELETE_TEST_DSN")
	if dsn == "" {
		t.Skip("requires empty thread_account_delete_test_* database")
	}
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil || !strings.HasPrefix(cfg.DBName, "thread_account_delete_test_") {
		t.Fatal("isolated database required")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	t.Cleanup(cancel)
	var tables int
	if err = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()").Scan(&tables); err != nil || tables != 0 {
		t.Fatal("empty database required")
	}
	// Legacy tables as in thread.ddl, foreign keys included.
	for _, query := range []string{
		"CREATE TABLE user_master(uid VARCHAR(255) NOT NULL PRIMARY KEY,username VARCHAR(255) NULL,google_auth_id VARCHAR(100) NULL UNIQUE,auth_id VARCHAR(50) NULL,auth_encrypted_pw VARCHAR(255) NULL)",
		"CREATE TABLE admin_master(uid VARCHAR(255) NULL,FOREIGN KEY(uid) REFERENCES user_master(uid))",
		"CREATE TABLE transactions(txid INT AUTO_INCREMENT PRIMARY KEY,version INT NOT NULL,type INT NOT NULL,`from` VARCHAR(255) NOT NULL,timestamp BIGINT NOT NULL,content BLOB NULL,hash VARCHAR(255) NOT NULL UNIQUE,FOREIGN KEY(`from`) REFERENCES user_master(uid))",
		"CREATE TABLE blocks(uid VARCHAR(255) NOT NULL,block_hash VARCHAR(255) NOT NULL,transitions LONGBLOB NULL,state LONGBLOB NULL,block_number BIGINT NULL,tx_hash VARCHAR(255) NULL,prev_block_hash VARCHAR(255) NULL,FOREIGN KEY(tx_hash) REFERENCES transactions(hash))",
	} {
		if _, err = db.ExecContext(ctx, query); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = migrations.Run(ctx, db, migrations.Server); err != nil {
		t.Fatal(err)
	}
	for _, account := range fixtureAccounts {
		for _, query := range account.statements() {
			if _, err = db.ExecContext(ctx, query); err != nil {
				t.Fatal(query, err)
			}
		}
	}
	return db, ctx
}

func scopeOf(t *testing.T, ctx context.Context, db *sql.DB, uid string) scope {
	s := scope{uid: uid}
	var user uint64
	if err := db.QueryRowContext(ctx, "SELECT id FROM sync_users WHERE uid=?", uid).Scan(&user); err == nil {
		s.user = user
	} else if !errors.Is(err, sql.ErrNoRows) {
		t.Fatal(err)
	}
	var vault string
	if err := db.QueryRowContext(ctx, "SELECT vault_id FROM vaults WHERE account_id=?", uid).Scan(&vault); err == nil {
		s.vault = vault
	} else if !errors.Is(err, sql.ErrNoRows) {
		t.Fatal(err)
	}
	return s
}

func count(t *testing.T, ctx context.Context, db *sql.DB, query string, args ...interface{}) int64 {
	var n int64
	if err := db.QueryRowContext(ctx, query, args...).Scan(&n); err != nil {
		t.Fatal(query, err)
	}
	return n
}

// census counts every table's rows in total and per account scope.
type census struct {
	total   map[string]int64
	account map[string]map[string]int64
}

func take(t *testing.T, ctx context.Context, db *sql.DB, scopes map[string]scope) census {
	c := census{total: map[string]int64{}, account: map[string]map[string]int64{}}
	for _, target := range targets {
		if count(t, ctx, db, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?", target.table) == 0 {
			continue
		}
		c.total[target.table] = count(t, ctx, db, "SELECT COUNT(*) FROM "+target.table)
		var attributed int64
		for uid, s := range scopes {
			if c.account[uid] == nil {
				c.account[uid] = map[string]int64{}
			}
			n := count(t, ctx, db, "SELECT COUNT(*) FROM "+target.table+" WHERE "+target.where, s.values(target.args)...)
			c.account[uid][target.table] = n
			attributed += n
		}
		// Every row belongs to exactly one account's scope.
		if attributed != c.total[target.table] {
			t.Fatalf("%s: %d rows, %d attributed to accounts", target.table, c.total[target.table], attributed)
		}
	}
	return c
}

func TestMySQLDeleteAccount(t *testing.T) {
	db, ctx := fixture(t)
	scopes := map[string]scope{}
	for _, account := range fixtureAccounts {
		scopes[account.uid] = scopeOf(t, ctx, db, account.uid)
	}
	before := take(t, ctx, db, scopes)
	for _, target := range targets {
		if before.account["fixture-a"][target.table] == 0 {
			t.Fatalf("fixture-a has no row in %s", target.table)
		}
	}

	// A row of another account that still points at A's data stops the delete,
	// and nothing of A is deleted.
	if _, err := db.ExecContext(ctx, "INSERT INTO blocks(uid,block_hash,block_number,tx_hash) VALUES('fixture-b','cross',2,'hash-fixture-a')"); err != nil {
		t.Fatal(err)
	}
	if err := Delete(ctx, db, "fixture-a"); err == nil {
		t.Fatal("delete ignored a foreign reference")
	}
	if count(t, ctx, db, "SELECT COUNT(*) FROM tasks WHERE user_id=1")+count(t, ctx, db, "SELECT COUNT(*) FROM encrypted_objects WHERE vault_id='vault-fixture-a'") != 2 {
		t.Fatal("failed delete was not rolled back")
	}
	if _, err := db.ExecContext(ctx, "DELETE FROM blocks WHERE block_hash='cross'"); err != nil {
		t.Fatal(err)
	}

	if err := Delete(ctx, db, "fixture-a"); err != nil {
		t.Fatal("delete", err)
	}
	after := take(t, ctx, db, scopes)
	for _, target := range targets {
		table := target.table
		if after.account["fixture-a"][table] != 0 {
			t.Fatalf("fixture-a left in %s", table)
		}
		if after.total[table] != before.total[table]-before.account["fixture-a"][table] {
			t.Fatalf("%s: other rows changed", table)
		}
		for uid := range scopes {
			if uid != "fixture-a" && after.account[uid][table] != before.account[uid][table] {
				t.Fatalf("%s: %s changed", table, uid)
			}
		}
	}

	// Repeating it, or deleting an account that never existed, has nothing to do.
	for _, uid := range []string{"fixture-a", "unknown"} {
		if err := Delete(ctx, db, uid); err != nil {
			t.Fatal("repeat", uid, err)
		}
	}
	if err := Delete(ctx, db, ""); !errors.Is(err, ErrUserRequired) {
		t.Fatal("empty uid", err)
	}

	// The other modes: v2 only, pending vault, login only (on an install without admin_master).
	for _, uid := range []string{"fixture-c", "fixture-d"} {
		if err := Delete(ctx, db, uid); err != nil {
			t.Fatal(uid, err)
		}
	}
	if _, err := db.ExecContext(ctx, "DROP TABLE admin_master"); err != nil {
		t.Fatal(err)
	}
	if err := Delete(ctx, db, "fixture-e"); err != nil {
		t.Fatal("fixture-e", err)
	}
	final := take(t, ctx, db, scopes)
	for _, target := range targets {
		table := target.table
		if _, ok := final.total[table]; !ok {
			continue
		}
		if final.total[table] != before.account["fixture-b"][table] || final.account["fixture-b"][table] != before.account["fixture-b"][table] {
			t.Fatalf("%s: only fixture-b must remain", table)
		}
	}
	if count(t, ctx, db, "SELECT COUNT(*) FROM user_master") != 1 || count(t, ctx, db, "SELECT COUNT(*) FROM vaults WHERE mode='active'") != 1 {
		t.Fatal("fixture-b changed")
	}
}
