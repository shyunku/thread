// Package legacyinventory counts account-scoped plaintext copies without reading their contents.
package legacyinventory

import (
	"context"
	"database/sql"
	"fmt"
	"thread_api/service/database/migrations"
)

type Entry struct {
	Source       string `json:"source"`
	Rows         int64  `json:"rows"`
	PayloadBytes int64  `json:"payloadBytes"`
}

type Report struct {
	AccountMode               string  `json:"accountMode"`
	VaultMode                 string  `json:"vaultMode"`
	Sources                   []Entry `json:"sources"`
	BackupsAndLogsNotIncluded bool    `json:"backupsAndLogsNotIncluded"`
}

type source struct {
	name, query string
	useUID      bool
}

var sources = []source{
	{"tasks", "SELECT COUNT(*),COALESCE(SUM(OCTET_LENGTH(title)+OCTET_LENGTH(memo)),0) FROM tasks WHERE user_id=?", false},
	{"categories", "SELECT COUNT(*),COALESCE(SUM(OCTET_LENGTH(title)),0) FROM categories WHERE user_id=?", false},
	{"subtasks", "SELECT COUNT(*),COALESCE(SUM(OCTET_LENGTH(title)),0) FROM subtasks WHERE user_id=?", false},
	{"task_categories", "SELECT COUNT(*),0 FROM task_categories WHERE user_id=?", false},
	{"sync_change_log", "SELECT COUNT(*),COALESCE(SUM(OCTET_LENGTH(payload)),0) FROM sync_change_log WHERE user_id=?", false},
	{"sync_receipts", "SELECT COUNT(*),COALESCE(SUM(OCTET_LENGTH(result)),0) FROM sync_receipts WHERE user_id=?", false},
	{"sync_occurrences", "SELECT COUNT(*),COALESCE(SUM(OCTET_LENGTH(result)),0) FROM sync_occurrences WHERE user_id=?", false},
	{"sync_snapshots", "SELECT COUNT(*),0 FROM sync_snapshots WHERE user_id=?", false},
	{"sync_snapshot_pages", "SELECT COUNT(*),COALESCE(SUM(OCTET_LENGTH(payload)),0) FROM sync_snapshot_pages WHERE user_id=?", false},
	{"vault_migration_source_pages", "SELECT COUNT(*),COALESCE(SUM(OCTET_LENGTH(p.payload)),0) FROM vault_migration_source_pages p JOIN vault_migrations m ON m.migration_id=p.migration_id WHERE m.source_user=?", false},
	{"legacy_blocks", "SELECT COUNT(*),COALESCE(SUM(COALESCE(OCTET_LENGTH(state),0)+COALESCE(OCTET_LENGTH(transitions),0)),0) FROM blocks WHERE uid=?", true},
	{"legacy_transactions", "SELECT COUNT(*),COALESCE(SUM(OCTET_LENGTH(content)),0) FROM transactions WHERE `from`=?", true},
}

// Read never applies schema changes or fetches task, snapshot, or transaction contents.
func Read(ctx context.Context, db *sql.DB, uid string) (Report, error) {
	var result Report
	if uid == "" {
		return result, fmt.Errorf("USER_REQUIRED")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return result, fmt.Errorf("INVENTORY_TRANSACTION_FAILED")
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, "SELECT version,name,checksum,state FROM thread_schema_migrations ORDER BY version")
	if err != nil {
		return result, fmt.Errorf("CURRENT_SCHEMA_REQUIRED")
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
		return result, fmt.Errorf("CURRENT_SCHEMA_REQUIRED")
	}
	var userID int64
	err = tx.QueryRowContext(ctx, "SELECT id,mode FROM sync_users WHERE uid=?", uid).Scan(&userID, &result.AccountMode)
	if err != nil {
		return Report{}, fmt.Errorf("ACCOUNT_NOT_READY")
	}
	var vaultMode sql.NullString
	if err = tx.QueryRowContext(ctx, "SELECT mode FROM vaults WHERE account_id=?", uid).Scan(&vaultMode); err != nil && err != sql.ErrNoRows {
		return Report{}, fmt.Errorf("VAULT_STATUS_FAILED")
	}
	if vaultMode.Valid {
		result.VaultMode = vaultMode.String
	}
	result.Sources = make([]Entry, 0, len(sources))
	for _, spec := range sources {
		item := Entry{Source: spec.name}
		var scope interface{} = userID
		if spec.useUID {
			scope = uid
		}
		if err = tx.QueryRowContext(ctx, spec.query, scope).Scan(&item.Rows, &item.PayloadBytes); err != nil {
			return Report{}, fmt.Errorf("INVENTORY_%s_FAILED", spec.name)
		}
		result.Sources = append(result.Sources, item)
	}
	result.BackupsAndLogsNotIncluded = true
	if err = tx.Commit(); err != nil {
		return Report{}, fmt.Errorf("INVENTORY_TRANSACTION_FAILED")
	}
	return result, nil
}
