package vault

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/hex"
	"strconv"
	"time"
)

func manifestParameter(p map[string]interface{}) ([]byte, error) {
	value, ok := p["ciphertextManifest"].(string)
	if !ok {
		return nil, ErrInvalid
	}
	digest, e := hex.DecodeString(value)
	if e != nil || len(digest) != 32 || hex.EncodeToString(digest) != value {
		return nil, ErrInvalid
	}
	return digest, nil
}
func activeMigration(ctx context.Context, tx *sql.Tx, c migrationControl, l migrationLocks, status MigrationStatus) error {
	if l.mode != "e2ee_frozen" || l.vaultMode != "migrating" || l.vaultEpoch != status.TargetEpoch ||
		c.epoch != status.TargetEpoch || c.revision != l.revision || c.generation != l.generation ||
		l.sourceEpoch != status.SourceEpoch || strconv.FormatUint(l.seq, 10) != status.FreezeSeq {
		return ErrConflict
	}
	var active string
	if e := tx.QueryRowContext(ctx, `SELECT migration_id FROM vault_migration_active WHERE vault_id=?`, c.vaultID).Scan(&active); e != nil {
		return e
	}
	if active != status.ID {
		return ErrConflict
	}
	return nil
}

// The server validates checkpoint/count/manifest consistency, not plaintext.
func (s *Store) VerifyMigration(ctx context.Context, uid string, raw []byte) (MigrationStatus, error) {
	var out MigrationStatus
	c, e := parseMigrationControl(raw, "verify")
	if e != nil {
		return out, e
	}
	id, e := migrationID(c.parameters)
	if e != nil {
		return out, e
	}
	digest, e := manifestParameter(c.parameters)
	if e != nil {
		return out, e
	}
	snapshotID, _ := c.parameters["snapshotId"].(string)
	freeze, ok := decimal(c.parameters["freezeSeq"], false)
	pages, pok := c.parameters["sourcePageCount"].(uint64)
	objects, ook := c.parameters["sourceObjectCount"].(uint64)
	if len(c.parameters) != 6 || len(snapshotID) != 36 || !ok || !pok || !ook {
		return out, ErrInvalid
	}
	tx, l, e := s.lockMigration(ctx, uid, c)
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	out, e = migrationStatus(ctx, tx, id, c.vaultID, c.deviceID)
	if e != nil {
		return out, e
	}
	if e = activeMigration(ctx, tx, c, l, out); e != nil {
		return out, e
	}
	if (out.Phase != "FROZEN" && out.Phase != "UPLOADING" && out.Phase != "VERIFIED") || out.FreezeSeq != strconv.FormatUint(freeze, 10) || out.PageCount != pages || out.ObjectCount != objects {
		return out, ErrConflict
	}
	var seq, count uint64
	var head, sum []byte
	e = tx.QueryRowContext(ctx, `SELECT seq,object_count,membership_head,manifest_digest FROM encrypted_snapshots WHERE id=? AND vault_id=? AND epoch=? AND expires_at>?`, snapshotID, c.vaultID, out.TargetEpoch, time.Now().Unix()).Scan(&seq, &count, &head, &sum)
	if e == sql.ErrNoRows {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	var currentSeq uint64
	var currentHead []byte
	e = tx.QueryRowContext(ctx, `SELECT COALESCE(s.last_seq,0),v.membership_head FROM vaults v LEFT JOIN vault_sync s ON s.vault_id=v.vault_id WHERE v.vault_id=?`, c.vaultID).Scan(&currentSeq, &currentHead)
	if e != nil {
		return out, e
	}
	if count != objects || seq != currentSeq || !bytes.Equal(head, currentHead) || !bytes.Equal(sum, digest) {
		return out, ErrConflict
	}
	if out.Phase == "VERIFIED" {
		if out.CiphertextManifest != hex.EncodeToString(digest) {
			return out, ErrConflict
		}
		return out, tx.Commit()
	}
	_, e = tx.ExecContext(ctx, `INSERT INTO vault_migration_verifications(migration_id,snapshot_id,ciphertext_manifest,stage_seq,membership_head,key_generation,object_count,signed_attestation) VALUES(?,?,?,?,?,?,?,?)`, id, snapshotID, digest, seq, head, l.generation, objects, raw)
	if e != nil {
		return out, e
	}
	if _, e = tx.ExecContext(ctx, `UPDATE vault_migrations SET phase='VERIFIED' WHERE migration_id=?`, id); e != nil {
		return out, e
	}
	out.Phase = "VERIFIED"
	out.CiphertextManifest = hex.EncodeToString(digest)
	return out, tx.Commit()
}
func (s *Store) CommitMigration(ctx context.Context, uid string, raw []byte) (MigrationStatus, error) {
	var out MigrationStatus
	c, e := parseMigrationControl(raw, "commit")
	if e != nil {
		return out, e
	}
	id, e := migrationID(c.parameters)
	if e != nil {
		return out, e
	}
	digest, e := manifestParameter(c.parameters)
	if e != nil {
		return out, e
	}
	target, _ := c.parameters["targetEpoch"].(string)
	freeze, ok := decimal(c.parameters["freezeSeq"], false)
	if len(c.parameters) != 4 || !ok {
		return out, ErrInvalid
	}
	tx, l, e := s.lockMigration(ctx, uid, c)
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	out, e = migrationStatus(ctx, tx, id, c.vaultID, c.deviceID)
	if e != nil {
		return out, e
	}
	if out.TargetEpoch != target || out.FreezeSeq != strconv.FormatUint(freeze, 10) || out.CiphertextManifest != hex.EncodeToString(digest) {
		return out, ErrConflict
	}
	if out.Phase == "ACTIVE" {
		return out, tx.Commit()
	}
	if out.Phase != "VERIFIED" {
		return out, ErrConflict
	}
	if e = activeMigration(ctx, tx, c, l, out); e != nil {
		return out, e
	}
	var currentSeq, verifiedSeq, generation uint64
	var currentHead, verifiedHead []byte
	e = tx.QueryRowContext(ctx, `SELECT COALESCE(s.last_seq,0),v.membership_head,a.stage_seq,a.membership_head,a.key_generation FROM vaults v LEFT JOIN vault_sync s ON s.vault_id=v.vault_id JOIN vault_migration_verifications a ON a.migration_id=? WHERE v.vault_id=?`, id, c.vaultID).Scan(&currentSeq, &currentHead, &verifiedSeq, &verifiedHead, &generation)
	if e != nil {
		return out, e
	}
	if currentSeq != verifiedSeq || generation != l.generation || !bytes.Equal(currentHead, verifiedHead) {
		return out, ErrConflict
	}
	for _, change := range []struct {
		query string
		arg   interface{}
	}{
		{`UPDATE sync_users SET mode='e2ee' WHERE id=?`, l.user},
		{`UPDATE vaults SET mode='active' WHERE vault_id=?`, c.vaultID},
		{`UPDATE vault_migrations SET phase='ACTIVE' WHERE migration_id=?`, id},
	} {
		if _, e = tx.ExecContext(ctx, change.query, change.arg); e != nil {
			return out, e
		}
	}
	// No deletion: original tasks, frozen copies and backups remain preserved.
	out.Phase = "ACTIVE"
	return out, tx.Commit()
}
