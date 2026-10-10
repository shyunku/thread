// Package legacypurge deletes one migrated account's pre-2.0 plaintext copies (#80).
// It never reads their contents. A dry run reports row counts; a purge re-checks the
// account in one transaction, deletes only when the counts still match the dry run,
// and rolls back on any difference.
package legacypurge

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"thread_api/service/database/migrations"
)

var (
	ErrUserRequired   = errors.New("USER_REQUIRED")
	ErrSchema         = errors.New("CURRENT_SCHEMA_REQUIRED")
	ErrAccountNotDone = errors.New("ACCOUNT_NOT_MIGRATED")
	ErrPlanChanged    = errors.New("PLAN_CHANGED")
	ErrDeleteMismatch = errors.New("DELETE_COUNT_MISMATCH")
)

type Count struct {
	Source string `json:"source"`
	Rows   int64  `json:"rows"`
}

// Plan is what a purge will delete. It carries no account identity or content.
type Plan struct {
	MigrationID string  `json:"migrationId"`
	Counts      []Count `json:"counts"`
}

type target struct {
	source, count, remove string
	byUID                 bool
}

// Child tables first so foreign keys hold at every step. Login (user_master,
// sync_users), device and backfill metadata, vaults, migration records and all
// encrypted data are kept.
var targets = []target{
	{"sync_occurrences", "SELECT COUNT(*) FROM sync_occurrences WHERE user_id=?", "DELETE FROM sync_occurrences WHERE user_id=?", false},
	{"subtasks", "SELECT COUNT(*) FROM subtasks WHERE user_id=?", "DELETE FROM subtasks WHERE user_id=?", false},
	{"task_categories", "SELECT COUNT(*) FROM task_categories WHERE user_id=?", "DELETE FROM task_categories WHERE user_id=?", false},
	{"tasks", "SELECT COUNT(*) FROM tasks WHERE user_id=?", "DELETE FROM tasks WHERE user_id=?", false},
	{"categories", "SELECT COUNT(*) FROM categories WHERE user_id=?", "DELETE FROM categories WHERE user_id=?", false},
	{"sync_receipts", "SELECT COUNT(*) FROM sync_receipts WHERE user_id=?", "DELETE FROM sync_receipts WHERE user_id=?", false},
	{"sync_change_log", "SELECT COUNT(*) FROM sync_change_log WHERE user_id=?", "DELETE FROM sync_change_log WHERE user_id=?", false},
	{"sync_snapshot_pages", "SELECT COUNT(*) FROM sync_snapshot_pages WHERE user_id=?", "DELETE FROM sync_snapshot_pages WHERE user_id=?", false},
	{"sync_snapshots", "SELECT COUNT(*) FROM sync_snapshots WHERE user_id=?", "DELETE FROM sync_snapshots WHERE user_id=?", false},
	{"vault_migration_source_pages",
		"SELECT COUNT(*) FROM vault_migration_source_pages p JOIN vault_migrations m ON m.migration_id=p.migration_id WHERE m.source_user=?",
		"DELETE p FROM vault_migration_source_pages p JOIN vault_migrations m ON m.migration_id=p.migration_id WHERE m.source_user=?", false},
	{"legacy_blocks", "SELECT COUNT(*) FROM blocks WHERE uid=?", "DELETE FROM blocks WHERE uid=?", true},
	{"legacy_transactions", "SELECT COUNT(*) FROM transactions WHERE `from`=?", "DELETE FROM transactions WHERE `from`=?", true},
}

func checkSchema(ctx context.Context, tx *sql.Tx) error {
	rows, err := tx.QueryContext(ctx, "SELECT version,name,checksum,state FROM thread_schema_migrations ORDER BY version")
	if err != nil {
		return ErrSchema
	}
	ledger := []migrations.Applied{}
	for rows.Next() {
		var item migrations.Applied
		if err = rows.Scan(&item.Version, &item.Name, &item.Checksum, &item.State); err != nil {
			break
		}
		ledger = append(ledger, item)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil || len(ledger) != len(migrations.Server) || migrations.Validate(migrations.Server, ledger) != nil {
		return ErrSchema
	}
	return nil
}

// prepare locks the account, its vault and its migrations, checks that the account
// finished moving to E2EE, and counts the rows a purge would delete.
func prepare(ctx context.Context, tx *sql.Tx, uid string) (int64, Plan, error) {
	var plan Plan
	if err := checkSchema(ctx, tx); err != nil {
		return 0, plan, err
	}
	var user int64
	var mode string
	if err := tx.QueryRowContext(ctx, "SELECT id,mode FROM sync_users WHERE uid=? FOR UPDATE", uid).Scan(&user, &mode); err != nil || mode != "e2ee" {
		return 0, plan, ErrAccountNotDone
	}
	var vaultMode string
	if err := tx.QueryRowContext(ctx, "SELECT mode FROM vaults WHERE account_id=? FOR UPDATE", uid).Scan(&vaultMode); err != nil || vaultMode != "active" {
		return 0, plan, ErrAccountNotDone
	}
	rows, err := tx.QueryContext(ctx, "SELECT migration_id,phase FROM vault_migrations WHERE source_user=? ORDER BY migration_id FOR UPDATE", user)
	if err != nil {
		return 0, plan, ErrAccountNotDone
	}
	for rows.Next() {
		var id, phase string
		if err = rows.Scan(&id, &phase); err != nil {
			break
		}
		switch phase {
		case "ACTIVE":
			if plan.MigrationID != "" {
				err = ErrAccountNotDone
			}
			plan.MigrationID = id
		case "CANCELLED":
		default:
			err = ErrAccountNotDone
		}
		if err != nil {
			break
		}
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil || plan.MigrationID == "" {
		return 0, Plan{}, ErrAccountNotDone
	}
	for _, t := range targets {
		var scope interface{} = user
		if t.byUID {
			scope = uid
		}
		item := Count{Source: t.source}
		if err = tx.QueryRowContext(ctx, t.count, scope).Scan(&item.Rows); err != nil {
			return 0, Plan{}, fmt.Errorf("COUNT_%s_FAILED", t.source)
		}
		plan.Counts = append(plan.Counts, item)
	}
	return user, plan, nil
}

// DryRun reports what Purge would delete and changes nothing.
func DryRun(ctx context.Context, db *sql.DB, uid string) (Plan, error) {
	if uid == "" {
		return Plan{}, ErrUserRequired
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return Plan{}, err
	}
	defer tx.Rollback()
	_, plan, err := prepare(ctx, tx, uid)
	return plan, err
}

func samePlan(a, b Plan) bool {
	if a.MigrationID != b.MigrationID || len(a.Counts) != len(b.Counts) {
		return false
	}
	for i := range a.Counts {
		if a.Counts[i] != b.Counts[i] {
			return false
		}
	}
	return true
}

// Purge deletes the rows in expected (a reviewed DryRun result) in one transaction.
// Any change since the dry run, or any delete count that differs, rolls it all back.
func Purge(ctx context.Context, db *sql.DB, uid string, expected Plan) (Plan, error) {
	if uid == "" {
		return Plan{}, ErrUserRequired
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return Plan{}, err
	}
	defer tx.Rollback()
	user, plan, err := prepare(ctx, tx, uid)
	if err != nil {
		return Plan{}, err
	}
	if !samePlan(plan, expected) {
		return Plan{}, ErrPlanChanged
	}
	for i, t := range targets {
		var scope interface{} = user
		if t.byUID {
			scope = uid
		}
		result, err := tx.ExecContext(ctx, t.remove, scope)
		if err != nil {
			return Plan{}, fmt.Errorf("DELETE_%s_FAILED", t.source)
		}
		if n, err := result.RowsAffected(); err != nil || n != plan.Counts[i].Rows {
			return Plan{}, ErrDeleteMismatch
		}
	}
	for _, t := range targets {
		var scope interface{} = user
		if t.byUID {
			scope = uid
		}
		var left int64
		if err = tx.QueryRowContext(ctx, t.count, scope).Scan(&left); err != nil || left != 0 {
			return Plan{}, ErrDeleteMismatch
		}
	}
	if err = tx.Commit(); err != nil {
		return Plan{}, err
	}
	return plan, nil
}
