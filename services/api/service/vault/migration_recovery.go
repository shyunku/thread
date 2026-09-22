package vault

import (
	"context"
	"database/sql"
	"strconv"
)

// Caller holds account then vault locks and has verified the CURRENT recovery
// signature. Never reachable with only a login token or an old device key.
func cancelLostCoordinator(ctx context.Context, tx *sql.Tx, uid, vaultID string, user, seq uint64, sourceEpoch string) error {
	var id, coordinator, previous, epoch string
	err := tx.QueryRowContext(ctx, `SELECT m.migration_id,m.coordinator,m.prior_vault_epoch,v.epoch
 FROM vault_migration_active a JOIN vault_migrations m ON m.migration_id=a.migration_id
 JOIN vaults v ON v.vault_id=a.vault_id WHERE a.vault_id=? AND v.account_id=? AND v.mode='migrating'`, vaultID, uid).Scan(&id, &coordinator, &previous, &epoch)
	if err != nil {
		return err
	}
	status, err := migrationStatus(ctx, tx, id, vaultID, coordinator)
	if err != nil {
		return err
	}
	if (status.Phase != "FROZEN" && status.Phase != "UPLOADING" && status.Phase != "VERIFIED") ||
		status.TargetEpoch != epoch || status.SourceEpoch != sourceEpoch || status.FreezeSeq != strconv.FormatUint(seq, 10) {
		return ErrConflict
	}
	// Proven temporary ciphertext only. Plaintext source pages, verification
	// evidence and old device counters survive just as with ordinary cancellation.
	if err = clearMigrationCiphertext(ctx, tx, uid, status); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM vault_migration_active WHERE migration_id=?`, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE vault_migrations SET phase='CANCELLED' WHERE migration_id=?`, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE sync_users SET mode='v2' WHERE id=?`, user); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE vaults SET mode='pending',epoch=? WHERE vault_id=?`, previous, vaultID)
	return err
}
