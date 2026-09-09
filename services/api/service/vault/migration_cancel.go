package vault

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
)

// Caller holds sync_users then vaults FOR UPDATE. Prepare requires an empty
// ciphertext namespace; migration writes bind every record to its fresh epoch.
// Check provenance again before cleanup; ambiguous/orphaned data is retained.
func clearMigrationCiphertext(ctx context.Context, tx *sql.Tx, uid string, status MigrationStatus) error {
	var key []byte
	if e := tx.QueryRowContext(ctx, `SELECT signing_public_key FROM vault_devices WHERE vault_id=? AND device_id=? AND revoked_revision IS NULL`, status.VaultID, status.Coordinator).Scan(&key); e != nil {
		return e
	}
	records, e := tx.QueryContext(ctx, `SELECT seq,signed_record FROM encrypted_changes WHERE vault_id=? ORDER BY seq`, status.VaultID)
	if e != nil {
		return e
	}
	digests := map[string][]byte{}
	var sequence uint64
	for records.Next() {
		var seq uint64
		var raw []byte
		if e = records.Scan(&seq, &raw); e != nil {
			records.Close()
			return e
		}
		record, err := ParseRecord(raw)
		if err != nil || seq != sequence+1 || record.Body["schema"] != uint64(2) || record.Body["vaultId"] != status.VaultID ||
			record.Body["deviceId"] != status.Coordinator || record.Body["epoch"] != status.TargetEpoch || record.Verify(key, "mutation") != nil {
			records.Close()
			return ErrConflict
		}
		mutation, ok := record.Body["mutationId"].(string)
		if !ok || digests[mutation] != nil {
			records.Close()
			return ErrConflict
		}
		sum := sha256.Sum256(raw)
		digests[mutation] = sum[:]
		sequence = seq
	}
	e = records.Err()
	records.Close()
	if e != nil {
		return e
	}
	receipts, e := tx.QueryContext(ctx, `SELECT device_id,mutation_id,request_digest FROM encrypted_receipts WHERE vault_id=?`, status.VaultID)
	if e != nil {
		return e
	}
	var count uint64
	for receipts.Next() {
		var device, mutation string
		var digest []byte
		if e = receipts.Scan(&device, &mutation, &digest); e != nil {
			receipts.Close()
			return e
		}
		if device != status.Coordinator || !bytes.Equal(digest, digests[mutation]) {
			receipts.Close()
			return ErrConflict
		}
		count++
	}
	e = receipts.Err()
	receipts.Close()
	if e != nil {
		return e
	}
	if count != sequence {
		return ErrConflict
	}
	for _, query := range []string{
		`SELECT COUNT(*) FROM encrypted_objects o LEFT JOIN encrypted_changes c ON c.vault_id=o.vault_id AND c.seq=o.seq WHERE o.vault_id=? AND (c.seq IS NULL OR NOT(o.signed_record <=> c.signed_record))`,
		`SELECT COUNT(*) FROM encrypted_snapshot_objects o JOIN encrypted_snapshots s ON s.id=o.snapshot_id LEFT JOIN encrypted_changes c ON c.vault_id=s.vault_id AND c.seq=o.seq WHERE s.vault_id=? AND (c.seq IS NULL OR NOT(o.signed_record <=> c.signed_record))`,
	} {
		if e = tx.QueryRowContext(ctx, query, status.VaultID).Scan(&count); e != nil {
			return e
		}
		if count != 0 {
			return ErrConflict
		}
	}
	if e = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM encrypted_snapshots WHERE vault_id=? AND epoch<>?`, status.VaultID, status.TargetEpoch).Scan(&count); e != nil {
		return e
	}
	if count != 0 {
		return ErrConflict
	}

	// Every DELETE repeats the exact attempt/owner/coordinator/epoch/mode guard.
	// There is deliberately no cleanup path for an active vault.
	guard := `SELECT v.vault_id FROM vaults v JOIN vault_migration_active a ON a.vault_id=v.vault_id
 JOIN vault_migrations m ON m.migration_id=a.migration_id
 WHERE m.migration_id=? AND v.vault_id=? AND v.account_id=? AND m.coordinator=?
 AND m.target_epoch=? AND v.epoch=m.target_epoch AND v.mode='migrating'
 AND m.phase IN ('FROZEN','UPLOADING','VERIFIED')`
	args := []interface{}{status.ID, status.VaultID, uid, status.Coordinator, status.TargetEpoch}
	queries := []string{
		`DELETE o FROM encrypted_snapshot_objects o JOIN encrypted_snapshots s ON s.id=o.snapshot_id WHERE s.vault_id IN (` + guard + `)`,
		`DELETE FROM encrypted_snapshots WHERE vault_id IN (` + guard + `)`,
		`DELETE FROM encrypted_objects WHERE vault_id IN (` + guard + `)`,
		`DELETE FROM encrypted_changes WHERE vault_id IN (` + guard + `)`,
		`DELETE FROM encrypted_receipts WHERE vault_id IN (` + guard + `)`,
		`DELETE FROM vault_sync WHERE vault_id IN (` + guard + `)`,
	}
	for _, query := range queries {
		if _, e = tx.ExecContext(ctx, query, args...); e != nil {
			return e
		}
	}
	// last_counter is deliberately untouched; a cancelled attempt cannot reuse it.
	return nil
}
