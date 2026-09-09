package vault

import (
	"bytes"
	"context"
	"database/sql"
)

// Active revocation/recovery atomically rotates the key generation and recovery
// authority and stores a recipient-bound envelope for every surviving device.
// Old ciphertext/keys are retained by clients until re-encryption is verified.
func (s *Store) ApplyTransition(ctx context.Context, uid string, raw []byte) (Head, error) {
	if !validAccount(uid) {
		return Head{}, ErrForbidden
	}
	r, err := ParseRecord(raw)
	if err != nil {
		return Head{}, err
	}
	b := r.Body
	id, _ := b["vaultId"].(string)
	revision, rok := b["revision"].(uint64)
	generation, gok := b["keyGeneration"].(uint64)
	previous, _ := b["previous"].(string)
	operation, _ := b["operation"].(string)
	signer, _ := b["signer"].(string)
	authority, _ := b["recoveryKey"].([]byte)
	recoveryEnvelope, _ := b["recoveryEnvelope"].([]byte)
	list, lok := b["devices"].([]interface{})
	envelopes, eok := b["envelopes"].([]interface{})
	if len(b) != 11 || b["schema"] != uint64(1) || !identifier.MatchString(id) || !rok || revision == 0 || !gok || generation < 2 ||
		len(authority) != 32 || len(recoveryEnvelope) < 48 || !lok || len(list) < 1 || len(list) > 32 || !eok || len(envelopes) != len(list) ||
		(operation != "rotate" && operation != "recover") || (operation == "rotate" && !identifier.MatchString(signer)) || (operation == "recover" && b["signer"] != nil) {
		return Head{}, ErrInvalid
	}
	devices := map[string]Device{}
	keys := map[string]bool{}
	hasAuthority := false
	for _, value := range list {
		d, e := ParseDevice(value)
		if e != nil {
			return Head{}, e
		}
		if _, ok := devices[d.ID]; ok || keys[string(d.SigningKey)] {
			return Head{}, ErrInvalid
		}
		devices[d.ID] = d
		keys[string(d.SigningKey)] = true
		hasAuthority = hasAuthority || d.Authorize
	}
	if !hasAuthority {
		return Head{}, ErrForbidden
	}
	recipients := map[string]bool{}
	for _, value := range envelopes {
		envelope, ok := value.(map[string]interface{})
		if !ok || len(envelope) != 2 {
			return Head{}, ErrInvalid
		}
		recipient, _ := envelope["deviceId"].(string)
		ciphertext, _ := envelope["ciphertext"].([]byte)
		if _, ok := devices[recipient]; !ok || recipients[recipient] || len(ciphertext) < 48 {
			return Head{}, ErrInvalid
		}
		recipients[recipient] = true
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return Head{}, err
	}
	defer tx.Rollback()
	var current, currentGeneration uint64
	var head, oldAuthority []byte
	var mode string
	err = tx.QueryRowContext(ctx, `SELECT membership_revision,current_key_generation,membership_head,recovery_public_key,mode FROM vaults WHERE vault_id=? AND account_id=? FOR UPDATE`, id, uid).Scan(&current, &currentGeneration, &head, &oldAuthority, &mode)
	if err == sql.ErrNoRows {
		return Head{}, ErrNotFound
	}
	if err != nil {
		return Head{}, err
	}
	if mode != "active" {
		return Head{}, ErrInactive
	}
	if revision <= current {
		var prior []byte
		if err = tx.QueryRowContext(ctx, `SELECT signed_record FROM vault_membership_events WHERE vault_id=? AND revision=?`, id, revision).Scan(&prior); err == nil && bytes.Equal(prior, raw) {
			return Head{id, current, HeadString(head)}, nil
		}
		return Head{}, ErrConflict
	}
	if revision != current+1 || generation != currentGeneration+1 || previous != HeadString(head) || bytes.Equal(oldAuthority, authority) {
		return Head{}, ErrConflict
	}
	signing := oldAuthority
	purpose := "recovery-transition"
	if operation == "rotate" {
		var authorized bool
		err = tx.QueryRowContext(ctx, `SELECT signing_public_key,can_authorize_devices FROM vault_devices WHERE vault_id=? AND device_id=? AND revoked_revision IS NULL`, id, signer).Scan(&signing, &authorized)
		if err == sql.ErrNoRows {
			return Head{}, ErrForbidden
		}
		if err != nil {
			return Head{}, err
		}
		if !authorized {
			return Head{}, ErrForbidden
		}
		purpose = "membership-transition"
	}
	if err = r.Verify(signing, purpose); err != nil {
		return Head{}, err
	}
	type existingDevice struct {
		signing, encryption []byte
		revoked             sql.NullInt64
	}
	existing := map[string]existingDevice{}
	rows, err := tx.QueryContext(ctx, `SELECT device_id,signing_public_key,encryption_public_key,revoked_revision FROM vault_devices WHERE vault_id=?`, id)
	if err != nil {
		return Head{}, err
	}
	for rows.Next() {
		var key string
		var d existingDevice
		if err = rows.Scan(&key, &d.signing, &d.encryption, &d.revoked); err != nil {
			rows.Close()
			return Head{}, err
		}
		existing[key] = d
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return Head{}, err
	}
	for key, device := range devices {
		if old, ok := existing[key]; ok && (operation == "recover" || old.revoked.Valid || !bytes.Equal(old.signing, device.SigningKey) || !bytes.Equal(old.encryption, device.EncryptionKey)) {
			return Head{}, ErrConflict
		}
	}
	digest, err := Fingerprint(r.Value)
	if err != nil {
		return Head{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO vault_membership_events(vault_id,revision,event_digest,previous_digest,signed_record) VALUES(?,?,?,?,?)`, id, revision, digest, head, raw); err != nil {
		return Head{}, conflict(err)
	}
	for key, old := range existing {
		if old.revoked.Valid {
			continue
		}
		device, keep := devices[key]
		if !keep {
			_, err = tx.ExecContext(ctx, `UPDATE vault_devices SET revoked_revision=? WHERE vault_id=? AND device_id=?`, revision, id, key)
		} else {
			_, err = tx.ExecContext(ctx, `UPDATE vault_devices SET role=?,can_authorize_devices=? WHERE vault_id=? AND device_id=?`, device.Role, device.Authorize, id, key)
		}
		if err != nil {
			return Head{}, err
		}
	}
	for key, device := range devices {
		if _, ok := existing[key]; !ok {
			if err = insertDevice(ctx, tx, id, revision, device); err != nil {
				return Head{}, err
			}
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO vault_key_envelopes(vault_id,recipient_device_id,key_generation,membership_revision,signed_envelope) VALUES(?,?,?,?,?)`, id, key, generation, revision, raw); err != nil {
			return Head{}, conflict(err)
		}
	}
	if _, err = tx.ExecContext(ctx, `UPDATE vaults SET membership_revision=?,membership_head=?,current_key_generation=?,recovery_public_key=? WHERE vault_id=?`, revision, digest, generation, authority, id); err != nil {
		return Head{}, err
	}
	return Head{id, revision, HeadString(digest)}, tx.Commit()
}
