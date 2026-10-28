// Package accountdelete removes one account and everything stored for it (#92):
// login, legacy chain, plaintext sync data, the vault, its devices and every
// encrypted object. It never reads contents. Deletion is immediate and cannot be
// undone; deleting an account that is already gone succeeds with nothing to do.
package accountdelete

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

var (
	ErrUserRequired = errors.New("USER_REQUIRED")
	// ErrRowsRemain means a row of the account was still there after the deletes.
	// The transaction is rolled back and nothing is deleted.
	ErrRowsRemain = errors.New("ACCOUNT_ROWS_REMAIN")
)

// Scope values of one account. A missing sync user or vault is nil, which no
// row matches.
type scope struct {
	uid   string
	user  interface{} // sync_users.id
	vault interface{} // vaults.vault_id
}

const (
	byUID   = "uid"
	byUser  = "user"
	byVault = "vault"
)

type target struct {
	table string
	where string
	args  []string
	// optional tables exist only on some legacy installs.
	optional bool
}

const migrationsOf = "SELECT migration_id FROM vault_migrations WHERE vault_id=? OR source_user=?"

// Children first: there is no ON DELETE CASCADE, so every foreign key must
// already be clear when its parent row goes.
var targets = []target{
	// Vault migration records (v9, v10). vault_migrations references vault_devices.
	{table: "vault_migration_active", where: "vault_id=? OR migration_id IN (" + migrationsOf + ")", args: []string{byVault, byVault, byUser}},
	{table: "vault_migration_verifications", where: "migration_id IN (" + migrationsOf + ")", args: []string{byVault, byUser}},
	{table: "vault_migration_source_pages", where: "migration_id IN (" + migrationsOf + ")", args: []string{byVault, byUser}},
	{table: "vault_migrations", where: "vault_id=? OR source_user=?", args: []string{byVault, byUser}},
	// Encrypted data (v7, v8, v11).
	{table: "encrypted_receipts", where: "vault_id=?", args: []string{byVault}},
	{table: "encrypted_snapshot_objects", where: "vault_id=? OR snapshot_id IN (SELECT id FROM encrypted_snapshots WHERE vault_id=?)", args: []string{byVault, byVault}},
	{table: "encrypted_snapshots", where: "vault_id=?", args: []string{byVault}},
	{table: "encrypted_objects", where: "vault_id=?", args: []string{byVault}},
	{table: "encrypted_changes", where: "vault_id=?", args: []string{byVault}},
	{table: "encrypted_records", where: "vault_id=?", args: []string{byVault}},
	{table: "vault_sync", where: "vault_id=?", args: []string{byVault}},
	// Vault membership (v6).
	{table: "vault_key_envelopes", where: "vault_id=?", args: []string{byVault}},
	{table: "vault_devices", where: "vault_id=?", args: []string{byVault}},
	{table: "vault_membership_events", where: "vault_id=?", args: []string{byVault}},
	{table: "vaults", where: "vault_id=? OR account_id=?", args: []string{byVault, byUID}},
	// Plaintext v2 sync data (v3, v4, v5) and the sync account.
	{table: "sync_occurrences", where: "user_id=?", args: []string{byUser}},
	{table: "subtasks", where: "user_id=?", args: []string{byUser}},
	{table: "task_categories", where: "user_id=?", args: []string{byUser}},
	{table: "tasks", where: "user_id=?", args: []string{byUser}},
	{table: "categories", where: "user_id=?", args: []string{byUser}},
	{table: "sync_receipts", where: "user_id=?", args: []string{byUser}},
	{table: "sync_devices", where: "user_id=?", args: []string{byUser}},
	{table: "sync_change_log", where: "user_id=?", args: []string{byUser}},
	{table: "sync_snapshot_pages", where: "user_id=?", args: []string{byUser}},
	{table: "sync_snapshots", where: "user_id=?", args: []string{byUser}},
	{table: "sync_backfills", where: "user_id=?", args: []string{byUser}},
	{table: "sync_users", where: "id=? OR uid=?", args: []string{byUser, byUID}},
	// Legacy (pre-2.0) chain and login.
	{table: "blocks", where: "uid=?", args: []string{byUID}},
	{table: "transactions", where: "`from`=?", args: []string{byUID}},
	{table: "admin_master", where: "uid=?", args: []string{byUID}, optional: true},
	{table: "user_master", where: "uid=?", args: []string{byUID}},
}

func (s scope) values(keys []string) []interface{} {
	values := make([]interface{}, len(keys))
	for i, key := range keys {
		switch key {
		case byUID:
			values[i] = s.uid
		case byUser:
			values[i] = s.user
		case byVault:
			values[i] = s.vault
		}
	}
	return values
}

func tableExists(ctx context.Context, tx *sql.Tx, table string) (bool, error) {
	var n int
	err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?", table).Scan(&n)
	return n > 0, err
}

// lock takes the account's rows in the order the rest of the server uses
// (user_master, sync_users, vaults), so concurrent requests wait for the
// delete and then find the account gone.
func lock(ctx context.Context, tx *sql.Tx, uid string) (scope, error) {
	s := scope{uid: uid}
	var account string
	if err := tx.QueryRowContext(ctx, "SELECT uid FROM user_master WHERE uid=? FOR UPDATE", uid).Scan(&account); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return s, err
	}
	var user uint64
	switch err := tx.QueryRowContext(ctx, "SELECT id FROM sync_users WHERE uid=? FOR UPDATE", uid).Scan(&user); {
	case err == nil:
		s.user = user
	case !errors.Is(err, sql.ErrNoRows):
		return s, err
	}
	var vault string
	switch err := tx.QueryRowContext(ctx, "SELECT vault_id FROM vaults WHERE account_id=? FOR UPDATE", uid).Scan(&vault); {
	case err == nil:
		s.vault = vault
	case !errors.Is(err, sql.ErrNoRows):
		return s, err
	}
	return s, nil
}

// Delete removes the account uid in one transaction. Every account mode (v2,
// E2EE pending, migrating, active) is handled the same way. It commits only when
// no row of the account remains.
func Delete(ctx context.Context, db *sql.DB, uid string) error {
	if uid == "" {
		return ErrUserRequired
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	s, err := lock(ctx, tx, uid)
	if err != nil {
		return err
	}
	present := make([]bool, len(targets))
	for i, t := range targets {
		present[i] = true
		if t.optional {
			if present[i], err = tableExists(ctx, tx, t.table); err != nil {
				return err
			}
		}
	}
	for i, t := range targets {
		if !present[i] {
			continue
		}
		if _, err = tx.ExecContext(ctx, "DELETE FROM "+t.table+" WHERE "+t.where, s.values(t.args)...); err != nil {
			return fmt.Errorf("DELETE_%s_FAILED: %w", t.table, err)
		}
	}
	for i, t := range targets {
		if !present[i] {
			continue
		}
		var left int64
		if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+t.table+" WHERE "+t.where, s.values(t.args)...).Scan(&left); err != nil {
			return fmt.Errorf("COUNT_%s_FAILED: %w", t.table, err)
		}
		if left != 0 {
			return ErrRowsRemain
		}
	}
	return tx.Commit()
}

// Deleter deletes accounts in DB.
type Deleter struct {
	DB *sql.DB
}

func (d Deleter) Delete(ctx context.Context, uid string) error {
	return Delete(ctx, d.DB, uid)
}
