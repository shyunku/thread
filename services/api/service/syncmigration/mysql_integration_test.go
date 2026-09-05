package syncmigration

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/go-sql-driver/mysql"
	"os"
	"strings"
	"testing"
	"time"
)

func TestReadOnlyMySQLPreflight(t *testing.T) {
	writeDSN := os.Getenv("THREAD_PREFLIGHT_TEST_DSN")
	readDSN := os.Getenv("THREAD_PREFLIGHT_TEST_READ_DSN")
	if writeDSN == "" || readDSN == "" {
		t.Skip("explicit disposable preflight fixture and SELECT-only DSNs required")
	}
	cfg, e := mysql.ParseDSN(writeDSN)
	if e != nil || !strings.HasPrefix(cfg.DBName, "thread_preflight_test_") {
		t.Fatal("unsafe test database")
	}
	readCfg, e := mysql.ParseDSN(readDSN)
	if e != nil || readCfg.DBName != cfg.DBName || readCfg.User == cfg.User {
		t.Fatal("separate SELECT-only test user required")
	}
	db, e := sql.Open("mysql", writeDSN)
	if e != nil {
		t.Fatal("cannot open test DB")
	}
	defer db.Close()
	reader, e := sql.Open("mysql", readDSN)
	if e != nil {
		t.Fatal("cannot open reader")
	}
	defer reader.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	var count int
	if e = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()").Scan(&count); e != nil || count != 0 {
		t.Fatal("test DB must be empty")
	}
	statements := []string{
		"CREATE TABLE user_master(uid VARCHAR(255) PRIMARY KEY) ENGINE=InnoDB",
		"CREATE TABLE transactions(hash VARCHAR(255) PRIMARY KEY,version INT,type BIGINT,owner VARCHAR(255),timestamp BIGINT,content BLOB) ENGINE=InnoDB",
		"CREATE TABLE blocks(uid VARCHAR(255),block_number BIGINT,block_hash VARCHAR(255),tx_hash VARCHAR(255),state LONGBLOB) ENGINE=InnoDB",
	}
	for _, s := range statements {
		if _, e = db.ExecContext(ctx, s); e != nil {
			t.Fatal(e)
		}
	}
	// The production column is named 'from', a reserved SQL word.
	if _, e = db.ExecContext(ctx, "ALTER TABLE transactions CHANGE owner "+string(rune(96))+"from"+string(rune(96))+" VARCHAR(255)"); e != nil {
		t.Fatal(e)
	}
	originals := map[string][]byte{}
	for _, uid := range []string{"user-a", "user-b"} {
		st := fixture()
		a := st.Tasks["a"]
		a.Title = uid
		st.Tasks["a"] = a
		raw, _ := json.Marshal(st)
		originals[uid] = raw
		if _, e = db.ExecContext(ctx, "INSERT INTO user_master VALUES (?)", uid); e != nil {
			t.Fatal(e)
		}
		if _, e = db.ExecContext(ctx, "INSERT INTO transactions VALUES (?,2,0,?,123,?)", "tx-"+uid, uid, []byte("{}")); e != nil {
			t.Fatal(e)
		}
		if _, e = db.ExecContext(ctx, "INSERT INTO blocks VALUES (?,1,?,?,?)", uid, "block-"+uid, "tx-"+uid, raw); e != nil {
			t.Fatal(e)
		}
	}
	for _, uid := range []string{"user-a", "user-b"} {
		source, e := ReadSource(ctx, reader, uid)
		if e != nil {
			t.Fatal(e)
		}
		p, e := BuildPlan(source)
		if e != nil {
			t.Fatal(e)
		}
		if p.Rows.Tasks[0]["title"] != uid || len(source.Blocks) != 1 {
			t.Fatal("cross-user block collision")
		}
		again, e := ReadSource(ctx, reader, uid)
		if e != nil {
			t.Fatal(e)
		}
		second, e := BuildPlan(again)
		if e != nil || second.SourceChecksum != p.SourceChecksum || second.RowsChecksum != p.RowsChecksum {
			t.Fatal("read-only repeat changed plan")
		}
	}
	if _, e = reader.ExecContext(ctx, "DELETE FROM user_master"); e == nil {
		t.Fatal("test reader is not SELECT-only")
	}
	for uid, raw := range originals {
		var after []byte
		if e = db.QueryRowContext(ctx, "SELECT state FROM blocks WHERE uid=?", uid).Scan(&after); e != nil || string(after) != string(raw) {
			t.Fatal("source changed")
		}
	}
	if _, e = db.ExecContext(ctx, "INSERT INTO blocks SELECT * FROM blocks WHERE uid='user-a'"); e != nil {
		t.Fatal(e)
	}
	if _, e = ReadSource(ctx, reader, "user-a"); e == nil {
		t.Fatal("ambiguous latest block accepted")
	}
	if _, e = db.ExecContext(ctx, "UPDATE blocks SET tx_hash='tx-user-a' WHERE uid='user-b'"); e != nil {
		t.Fatal(e)
	}
	cross, e := ReadSource(ctx, reader, "user-b")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = BuildPlan(cross); e == nil {
		t.Fatal("cross-user transaction accepted")
	}
	if _, e = db.ExecContext(ctx, "UPDATE blocks SET tx_hash='missing' WHERE uid='user-b'"); e != nil {
		t.Fatal(e)
	}
	if _, e = ReadSource(ctx, reader, "user-b"); e == nil {
		t.Fatal("orphan block accepted")
	}
	if _, e = ReadSource(ctx, reader, "missing-user"); e == nil {
		t.Fatal("unknown user accepted")
	}
}
