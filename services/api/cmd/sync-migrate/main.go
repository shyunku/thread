// Operator-only tool. It never loads dotenv files or prints account contents.
package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"io"
	"os"
	"thread_api/service/canonical"
	"thread_api/service/database/migrations"
	"thread_api/service/syncmigration"
	"time"
)

func run(args []string, out, errOut io.Writer) error {
	f := flag.NewFlagSet("thread-sync-migrate", flag.ContinueOnError)
	f.SetOutput(errOut)
	prepare := f.Bool("prepare-schema", false, "prepare schema only")
	check := f.Bool("check-all", false, "read-only preflight of all legacy accounts")
	apply := f.Bool("apply-all", false, "backfill all legacy accounts; preserves v2 accounts")
	verify := f.Bool("verify-all", false, "read-only verification of all account modes")
	backup := f.Bool("backup-confirmed", false, "operator confirms a restorable backup")
	stopped := f.Bool("writers-stopped", false, "operator confirms ALL old API writers are stopped")
	env := f.String("dsn-env", "THREAD_MIGRATION_DSN", "environment variable holding MySQL DSN; never printed")
	timeout := f.Duration("timeout", 30*time.Minute, "whole command deadline")
	if e := f.Parse(args); e != nil {
		return e
	}
	actions := 0
	for _, v := range []bool{*prepare, *check, *apply, *verify} {
		if v {
			actions++
		}
	}
	if actions != 1 || f.NArg() != 0 || *timeout <= 0 || *timeout > 24*time.Hour {
		return fmt.Errorf("CHOOSE_ONE_ACTION_AND_VALID_TIMEOUT")
	}
	if (*prepare || *apply) && (!*backup || !*stopped) {
		return fmt.Errorf("OPERATOR_BACKUP_AND_WRITER_CONFIRMATION_REQUIRED")
	}
	dsn := os.Getenv(*env)
	if dsn == "" {
		return fmt.Errorf("MIGRATION_DSN_REQUIRED")
	}
	db, e := sql.Open("mysql", dsn)
	if e != nil {
		return fmt.Errorf("DATABASE_OPEN_FAILED")
	}
	defer db.Close()
	db.SetMaxOpenConns(16)
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()
	if *prepare {
		n, e := migrations.Run(ctx, db, migrations.Server)
		if e != nil {
			return fmt.Errorf("SCHEMA_PREPARATION_FAILED")
		}
		fmt.Fprintf(out, "schema=%d prepared; account data not migrated\n", n)
		return nil
	}
	// Refuse data operations on an unprepared schema, without running any DDL.
	var version int
	var dirty int
	if e = db.QueryRowContext(ctx, "SELECT COALESCE(MAX(version),0),COALESCE(SUM(state<>'applied'),0) FROM thread_schema_migrations").Scan(&version, &dirty); e != nil || version != len(migrations.Server) || dirty != 0 {
		return fmt.Errorf("PREPARED_CURRENT_SCHEMA_REQUIRED")
	}
	ledgerRows, e := db.QueryContext(ctx, "SELECT version,name,checksum,state FROM thread_schema_migrations ORDER BY version")
	if e != nil {
		return fmt.Errorf("SCHEMA_LEDGER_READ_FAILED")
	}
	ledger := []migrations.Applied{}
	for ledgerRows.Next() {
		var item migrations.Applied
		if e = ledgerRows.Scan(&item.Version, &item.Name, &item.Checksum, &item.State); e != nil {
			ledgerRows.Close()
			return fmt.Errorf("SCHEMA_LEDGER_READ_FAILED")
		}
		ledger = append(ledger, item)
	}
	e = ledgerRows.Err()
	ledgerRows.Close()
	if e != nil || len(ledger) != len(migrations.Server) || migrations.Validate(migrations.Server, ledger) != nil {
		return fmt.Errorf("SCHEMA_LEDGER_INVALID")
	}
	rows, e := db.QueryContext(ctx, "SELECT uid FROM user_master ORDER BY uid")
	if e != nil {
		return fmt.Errorf("ACCOUNT_LIST_FAILED")
	}
	users := []string{}
	for rows.Next() {
		var uid string
		if e = rows.Scan(&uid); e != nil {
			rows.Close()
			return fmt.Errorf("ACCOUNT_LIST_FAILED")
		}
		users = append(users, uid)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return fmt.Errorf("ACCOUNT_LIST_FAILED")
	}
	store := canonical.Store{DB: db}
	// Preflight the complete batch before the first data write.
	for i, uid := range users {
		var mode string
		var epoch sql.NullString
		e = db.QueryRowContext(ctx, "SELECT mode,epoch FROM sync_users WHERE uid=?", uid).Scan(&mode, &epoch)
		if e != nil && e != sql.ErrNoRows {
			return fmt.Errorf("ACCOUNT_%d_METADATA_FAILED", i+1)
		}
		if mode == "v2" {
			if _, e := uuid.Parse(epoch.String); e != nil {
				return fmt.Errorf("ACCOUNT_%d_EPOCH_INVALID", i+1)
			}
			continue
		}
		if *verify {
			return fmt.Errorf("ACCOUNT_%d_NOT_MIGRATED", i+1)
		}
		if mode != "" && mode != "legacy" {
			return fmt.Errorf("ACCOUNT_%d_REVIEW_REQUIRED", i+1)
		}
		source, e := syncmigration.ReadSource(ctx, db, uid)
		if e != nil {
			return fmt.Errorf("ACCOUNT_%d_PREFLIGHT_FAILED", i+1)
		}
		if _, e = syncmigration.BuildPlan(source); e != nil {
			return fmt.Errorf("ACCOUNT_%d_PREFLIGHT_FAILED", i+1)
		}
	}
	migrated := 0
	if *apply {
		for i, uid := range users {
			changed, e := store.BackfillAccount(ctx, uid)
			if e != nil {
				return fmt.Errorf("ACCOUNT_%d_APPLY_FAILED_RETRY_SAFE", i+1)
			}
			if changed {
				migrated++
			}
		}
	}
	fmt.Fprintf(out, "accounts=%d migrated=%d action_complete=true\n", len(users), migrated)
	return nil
}
func main() {
	if e := run(os.Args[1:], os.Stdout, os.Stderr); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
