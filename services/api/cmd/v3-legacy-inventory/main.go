// v3-legacy-inventory reads only account-scoped counts and byte lengths.
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
	"thread_api/service/legacyinventory"
	"time"
)

func run(args []string, stdout, stderr io.Writer) error {
	flags := flag.NewFlagSet("v3-legacy-inventory", flag.ContinueOnError)
	flags.SetOutput(stderr)
	uid := flags.String("user", "", "exact account UID")
	envKey := flags.String("dsn-env", "THREAD_V3_INVENTORY_DSN", "read-only MySQL DSN environment variable")
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
	report, err := legacyinventory.Read(ctx, db, *uid)
	if err != nil {
		return err
	}
	return json.NewEncoder(stdout).Encode(report)
}

func main() {
	if err := run(os.Args[1:], os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "inventory failed:", err)
		os.Exit(1)
	}
}
