package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"github.com/go-sql-driver/mysql"
	"os"
	"strings"
	"testing"
	"thread_api/service/canonical"
	"thread_api/service/database/migrations"
	"thread_api/service/state"
)

func TestMySQLOperatorRollout(t *testing.T) {
	dsn := os.Getenv("THREAD_ROLLOUT_TEST_DSN")
	if dsn == "" {
		t.Skip("explicit empty thread_rollout_test_* fixture DB required")
	}
	cfg, e := mysql.ParseDSN(dsn)
	if e != nil || !strings.HasPrefix(cfg.DBName, "thread_rollout_test_") {
		t.Fatal("unsafe fixture DB")
	}
	db, e := sql.Open("mysql", dsn)
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	var n int
	if e = db.QueryRow("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()").Scan(&n); e != nil || n != 0 {
		t.Fatal("empty fixture DB required")
	}
	exec := func(q string, args ...interface{}) {
		t.Helper()
		if _, e := db.Exec(q, args...); e != nil {
			t.Fatal(e)
		}
	}
	exec("CREATE TABLE user_master(uid VARCHAR(255) PRIMARY KEY) ENGINE=InnoDB")
	exec("CREATE TABLE transactions(txid INT,version INT,type INT,`from` VARCHAR(255),timestamp BIGINT,content BLOB,hash VARCHAR(255)) ENGINE=InnoDB")
	exec("CREATE TABLE blocks(uid VARCHAR(255),block_number BIGINT,state LONGBLOB,transitions LONGBLOB,tx_hash VARCHAR(255),block_hash VARCHAR(255),prev_block_hash VARCHAR(255)) ENGINE=InnoDB")
	const uid = "synthetic-private-marker"
	original := state.State{Tasks: map[string]state.Task{
		"a": {Id: "a", Title: "fixture title", Memo: "synthetic memo", CreatedAt: 123, DoneAt: 456, DueDate: 789, Done: true, Next: "b", RepeatPeriod: "month", RepeatStartAt: 100, Subtasks: map[string]state.Subtask{"s": {Id: "s", Title: "child", CreatedAt: 12, DoneAt: 34, DueDate: 56, Done: true}}, Categories: map[string]bool{"c": true}},
		"b": {Id: "b", Title: "second", Subtasks: map[string]state.Subtask{}, Categories: map[string]bool{}},
	}, Categories: map[string]state.Category{"c": {Id: "c", Title: "category", Secret: true, Locked: true, Color: "#abcdef", CreatedAt: 987}}}
	raw, _ := json.Marshal(original)
	exec("INSERT INTO user_master VALUES (?)", uid)
	exec("INSERT INTO transactions VALUES (1,2,0,?,1,?,'tx')", uid, raw)
	exec("INSERT INTO blocks(uid,block_number,state,tx_hash,block_hash) VALUES (?,1,?,'tx','block')", uid, raw)
	t.Setenv("THREAD_MIGRATION_DSN", dsn)
	if _, e = migrations.Run(context.Background(), db, migrations.Server[:4]); e != nil {
		t.Fatal(e)
	}
	var output bytes.Buffer
	invoke := func(args ...string) error {
		output.Reset()
		e := run(args, &output, &output)
		if strings.Contains(output.String(), uid) || strings.Contains(output.String(), "synthetic memo") {
			t.Fatal("private content printed")
		}
		return e
	}
	if e = invoke("--prepare-schema", "--backup-confirmed", "--writers-stopped"); e != nil {
		t.Fatal(e)
	}
	if e = invoke("--check-all"); e != nil {
		t.Fatal(e)
	}
	if e = db.QueryRow("SELECT COUNT(*) FROM sync_users").Scan(&n); e != nil || n != 0 {
		t.Fatal("check wrote metadata")
	}
	p := canonical.Protocol{Store: &canonical.Store{DB: db}, Enabled: true}
	if _, e = p.Account(context.Background(), uid); canonical.ErrorCode(e) != "ACCOUNT_MIGRATION_REQUIRED" {
		t.Fatal("legacy account auto imported", e)
	}
	if e = invoke("--verify-all"); e == nil {
		t.Fatal("unmigrated account passed")
	}
	exec("ALTER TABLE sync_backfills ADD CONSTRAINT deny_backfill CHECK (user_id=0)")
	if e = invoke("--apply-all", "--backup-confirmed", "--writers-stopped"); e == nil {
		t.Fatal("failure injection ignored")
	}
	for _, table := range []string{"tasks", "categories", "subtasks", "task_categories", "sync_users", "sync_backfills"} {
		if e = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); e != nil || n != 0 {
			t.Fatal("partial commit", table, n, e)
		}
	}
	exec("ALTER TABLE sync_backfills DROP CHECK deny_backfill")
	if e = invoke("--apply-all", "--backup-confirmed", "--writers-stopped"); e != nil {
		t.Fatal(e)
	}
	var epoch string
	if e = db.QueryRow("SELECT epoch FROM sync_users WHERE uid=?", uid).Scan(&epoch); e != nil {
		t.Fatal(e)
	}
	var memo, rank string
	var due, done int64
	if e = db.QueryRow("SELECT memo,sort_rank,due_date,done_at FROM tasks WHERE id='a'").Scan(&memo, &rank, &due, &done); e != nil || memo != "synthetic memo" || rank != "4294967296" || due != 789 || done != 456 {
		t.Fatal("field parity", e)
	}
	if e = invoke("--apply-all", "--backup-confirmed", "--writers-stopped"); e != nil {
		t.Fatal(e)
	}
	var after string
	exec("UPDATE tasks SET title='new v2 value' WHERE id='a'")
	if e = invoke("--apply-all", "--backup-confirmed", "--writers-stopped"); e != nil {
		t.Fatal(e)
	}
	var title string
	if e = db.QueryRow("SELECT title FROM tasks WHERE id='a'").Scan(&title); e != nil || title != "new v2 value" {
		t.Fatal("v2 edits overwritten", e)
	}
	db.QueryRow("SELECT epoch FROM sync_users WHERE uid=?", uid).Scan(&after)
	if epoch != after {
		t.Fatal("epoch changed on retry")
	}
	var preserved []byte
	db.QueryRow("SELECT state FROM blocks WHERE uid=?", uid).Scan(&preserved)
	if !bytes.Equal(raw, preserved) {
		t.Fatal("legacy state modified")
	}
	if e = invoke("--verify-all"); e != nil {
		t.Fatal(e)
	}
	exec("INSERT INTO user_master VALUES ('new-empty-user')")
	account, e := p.Account(context.Background(), "new-empty-user")
	if e != nil || account.Mode != "v2" || account.Epoch == "" {
		t.Fatal("new user", account, e)
	}
	if e = invoke("--verify-all"); e != nil {
		t.Fatal(e)
	}
}
