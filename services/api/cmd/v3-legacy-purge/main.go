// v3-legacy-purge deletes one migrated account's pre-2.0 plaintext copies (#80).
// Without -execute it only prints the plan (row counts). With -execute it needs the
// reviewed plan and the SHA-256 of the backup taken just before, and prints a receipt.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	_ "github.com/go-sql-driver/mysql"
	"io"
	"os"
	"regexp"
	"thread_api/service/legacypurge"
	"time"
)

type receipt struct {
	legacypurge.Plan
	BackupSHA256 string `json:"backupSha256"`
	PurgedAt     int64  `json:"purgedAt"`
}

var sha256Hex = regexp.MustCompile(`^[a-f0-9]{64}$`)

func run(args []string, stdout, stderr io.Writer) error {
	flags := flag.NewFlagSet("v3-legacy-purge", flag.ContinueOnError)
	flags.SetOutput(stderr)
	uid := flags.String("user", "", "exact account UID")
	envKey := flags.String("dsn-env", "THREAD_V3_PURGE_DSN", "MySQL DSN environment variable")
	execute := flags.Bool("execute", false, "delete (default: dry run)")
	planFile := flags.String("plan", "", "reviewed dry-run output (required with -execute)")
	backup := flags.String("backup-sha256", "", "SHA-256 of the backup taken just before (required with -execute)")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *uid == "" || flags.NArg() != 0 {
		return fmt.Errorf("USER_REQUIRED")
	}
	var expected legacypurge.Plan
	if *execute {
		if !sha256Hex.MatchString(*backup) {
			return fmt.Errorf("BACKUP_SHA256_REQUIRED")
		}
		raw, err := os.ReadFile(*planFile)
		if err != nil || json.Unmarshal(raw, &expected) != nil || expected.MigrationID == "" {
			return fmt.Errorf("PLAN_REQUIRED")
		}
	}
	dsn := os.Getenv(*envKey)
	if dsn == "" {
		return fmt.Errorf("DSN_REQUIRED")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return fmt.Errorf("DATABASE_OPEN_FAILED")
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if !*execute {
		plan, err := legacypurge.DryRun(ctx, db, *uid)
		if err != nil {
			return err
		}
		return json.NewEncoder(stdout).Encode(plan)
	}
	plan, err := legacypurge.Purge(ctx, db, *uid, expected)
	if err != nil {
		return err
	}
	return json.NewEncoder(stdout).Encode(receipt{Plan: plan, BackupSHA256: *backup, PurgedAt: time.Now().Unix()})
}

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "purge failed:", err)
		os.Exit(1)
	}
}
