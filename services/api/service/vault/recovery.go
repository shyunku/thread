package vault

import (
	"bytes"
	"context"
	"database/sql"
)

// RecoverPending replaces authority for a not-yet-active vault. Active recovery
// must also rotate ciphertext keys and remains blocked until that transaction exists.
func (s *Store) RecoverPending(ctx context.Context, uid string, raw []byte) (Head, error) {
	if !validAccount(uid) {
		return Head{}, ErrForbidden
	}
	r, e := ParseRecord(raw)
	if e != nil {
		return Head{}, e
	}
	b := r.Body
	id, _ := b["vaultId"].(string)
	revision, ok := b["revision"].(uint64)
	previous, _ := b["previous"].(string)
	generation, gok := b["keyGeneration"].(uint64)
	recovery, _ := b["recoveryKey"].([]byte)
	list, lok := b["devices"].([]interface{})
	if len(b) != 7 || b["operation"] != "recover" || !identifier.MatchString(id) || !ok || revision == 0 || !gok || generation == 0 || len(recovery) != 32 || !lok || len(list) < 1 || len(list) > 32 {
		return Head{}, ErrInvalid
	}
	devices := make([]Device, 0, len(list))
	authorized := false
	for _, v := range list {
		d, e := ParseDevice(v)
		if e != nil {
			return Head{}, e
		}
		authorized = authorized || d.Authorize
		devices = append(devices, d)
	}
	if !authorized {
		return Head{}, ErrForbidden
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return Head{}, e
	}
	defer tx.Rollback()
	var current, currentGeneration uint64
	var head, authority []byte
	var mode string
	e = tx.QueryRowContext(ctx, `SELECT membership_revision,membership_head,mode,recovery_public_key,current_key_generation FROM vaults WHERE vault_id=? AND account_id=? FOR UPDATE`, id, uid).Scan(&current, &head, &mode, &authority, &currentGeneration)
	if e == sql.ErrNoRows {
		return Head{}, ErrNotFound
	}
	if e != nil {
		return Head{}, e
	}
	if mode != "pending" {
		return Head{}, ErrRotationRequired
	}
	if revision <= current {
		var old []byte
		if e = tx.QueryRowContext(ctx, `SELECT signed_record FROM vault_membership_events WHERE vault_id=? AND revision=?`, id, revision).Scan(&old); e == nil && bytes.Equal(old, raw) {
			return Head{id, current, HeadString(head)}, nil
		}
		return Head{}, ErrConflict
	}
	if revision != current+1 || previous != HeadString(head) || generation != currentGeneration+1 || bytes.Equal(authority, recovery) {
		return Head{}, ErrConflict
	}
	if e = r.Verify(authority, "recovery"); e != nil {
		return Head{}, e
	}
	digest, e := Fingerprint(r.Value)
	if e != nil {
		return Head{}, e
	}
	_, e = tx.ExecContext(ctx, `INSERT INTO vault_membership_events(vault_id,revision,event_digest,previous_digest,signed_record) VALUES(?,?,?,?,?)`, id, revision, digest, head, raw)
	if e != nil {
		return Head{}, conflict(e)
	}
	_, e = tx.ExecContext(ctx, `UPDATE vault_devices SET revoked_revision=? WHERE vault_id=? AND revoked_revision IS NULL`, revision, id)
	if e != nil {
		return Head{}, e
	}
	for _, d := range devices {
		if e = insertDevice(ctx, tx, id, revision, d); e != nil {
			return Head{}, e
		}
	}
	_, e = tx.ExecContext(ctx, `UPDATE vaults SET membership_revision=?,membership_head=?,current_key_generation=?,recovery_public_key=? WHERE vault_id=?`, revision, digest, generation, recovery, id)
	if e != nil {
		return Head{}, e
	}
	return Head{id, revision, HeadString(digest)}, tx.Commit()
}
