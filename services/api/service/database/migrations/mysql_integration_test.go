package migrations

import (
	"context"
	"database/sql"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
)

// Run only against an explicitly supplied empty, disposable database.
// No production DB is selected implicitly and no database is dropped by this test.
func TestMySQLMigrationLifecycle(t *testing.T) {
	dsn := os.Getenv("THREAD_MIGRATION_TEST_DSN")
	if dsn == "" {
		t.Skip("set THREAD_MIGRATION_TEST_DSN to an empty thread_migration_test_* database")
	}
	config, err := mysql.ParseDSN(dsn)
	if err != nil || !strings.HasPrefix(config.DBName, "thread_migration_test_") {
		t.Fatal("test requires an explicit thread_migration_test_* database")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal("cannot open disposable migration database")
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	var count int
	if err = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()").Scan(&count); err != nil || count != 0 {
		t.Fatal("test database must be reachable and empty")
	}
	fixture := []string{
		"CREATE TABLE user_master(uid VARCHAR(255) PRIMARY KEY) ENGINE=InnoDB",
		"CREATE TABLE transactions(txid INT, version INT, type INT, `from` VARCHAR(255), timestamp BIGINT, content BLOB, hash VARCHAR(255)) ENGINE=InnoDB",
		"CREATE TABLE blocks(uid VARCHAR(255), block_number BIGINT, state LONGBLOB, transitions LONGBLOB, tx_hash VARCHAR(255), block_hash VARCHAR(255), prev_block_hash VARCHAR(255)) ENGINE=InnoDB",
		"INSERT INTO user_master VALUES ('fixture-user')",
		"INSERT INTO blocks(uid,block_number,state) VALUES ('fixture-user',1,'fixture-preserved')",
	}
	for _, statement := range fixture {
		if _, err = db.ExecContext(ctx, statement); err != nil {
			t.Fatal("fixture setup failed")
		}
	}
	if version, err := Run(ctx, db, Server[:2]); err != nil || version != 2 {
		t.Fatalf("existing schema preparation: version=%d error=%v", version, err)
	}
	if version, err := Run(ctx, db, Server); err != nil || version != len(Server) {
		t.Fatalf("first migration: version=%d error=%v", version, err)
	}
	if version, err := Run(ctx, db, Server); err != nil || version != len(Server) {
		t.Fatalf("repeat migration: version=%d error=%v", version, err)
	}
	var state string
	verifyVaultConstraints(t, db)
	if err := db.QueryRowContext(ctx, "SELECT state FROM blocks WHERE uid='fixture-user'").Scan(&state); err != nil || state != "fixture-preserved" {
		t.Fatal("legacy data changed")
	}
	concurrent := append(append([]Migration{}, Server...), Migration{Version: len(Server) + 1, Name: "concurrent_fixture", Statements: []string{"CREATE TABLE concurrent_fixture(id INT) ENGINE=InnoDB"}})
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, e := Run(ctx, db, concurrent); results <- e }()
	}
	wg.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM thread_schema_migrations").Scan(&count); err != nil || count != len(Server)+1 {
		t.Fatal("concurrent migration was not applied exactly once")
	}
	if _, err := Run(ctx, db, Server); err == nil {
		t.Fatal("downgrade accepted")
	}
	changed := append([]Migration{}, concurrent...)
	changed[0].Name = "changed"
	if _, err := Run(ctx, db, changed); err == nil {
		t.Fatal("checksum drift accepted")
	}
	broken := append(concurrent, Migration{Version: len(Server) + 2, Name: "partial_failure", Statements: []string{
		"CREATE TABLE partial_fixture(id INT) ENGINE=InnoDB", "THIS IS NOT VALID SQL",
	}})
	if _, err := Run(ctx, db, broken); err == nil {
		t.Fatal("partial DDL failure accepted")
	}
	var status string
	if err := db.QueryRowContext(ctx, "SELECT state FROM thread_schema_migrations WHERE version=?", len(Server)+2).Scan(&status); err != nil || status != "applying" {
		t.Fatal("partial failure not marked dirty")
	}
	if _, err := Run(ctx, db, broken); err == nil || !strings.Contains(err.Error(), "incomplete") {
		t.Fatal("dirty migration automatically retried")
	}
}
