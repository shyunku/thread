// sync-preflight never applies migrations, writes DB rows or replays blocks.
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
	"thread_api/service/syncmigration"
	"time"
)

func run(args []string, stdout, stderr io.Writer) error {
	flags := flag.NewFlagSet("sync-preflight", flag.ContinueOnError)
	flags.SetOutput(stderr)
	uid := flags.String("user", "", "exact account UID")
	envKey := flags.String("dsn-env", "THREAD_PREFLIGHT_DSN", "environment variable containing a read-only MySQL DSN; .env is not loaded")
	output := flags.String("plan-out", "", "optional NEW private JSON file containing task data; never overwritten")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *uid == "" || flags.NArg() != 0 {
		return fmt.Errorf("USER_REQUIRED")
	}
	dsn := os.Getenv(*envKey)
	if dsn == "" {
		return fmt.Errorf("READ_ONLY_DSN_REQUIRED")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return fmt.Errorf("DATABASE_OPEN_FAILED")
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	source, err := syncmigration.ReadSource(ctx, db, *uid)
	if err != nil {
		return err
	}
	plan, err := syncmigration.BuildPlan(source)
	if err != nil {
		return err
	}
	if *output != "" {
		if err := writePlan(*output, plan); err != nil {
			return err
		}
	}
	return json.NewEncoder(stdout).Encode(plan.Summary)
}
func writePlan(output string, plan *syncmigration.Plan) error {
	encoded, err := json.MarshalIndent(plan, "", "  ")
	if err != nil {
		return fmt.Errorf("PLAN_ENCODING_FAILED")
	}
	file, err := os.OpenFile(output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return fmt.Errorf("PLAN_OUTPUT_MUST_BE_NEW_AND_WRITABLE")
	}
	_, writeErr := file.Write(append(encoded, '\n'))
	if writeErr == nil {
		writeErr = file.Sync()
	}
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		return fmt.Errorf("PLAN_OUTPUT_INCOMPLETE: do not import; retained for inspection")
	}
	return nil
}
func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "preflight failed:", err)
		os.Exit(1)
	}
}
