package vault

import (
	"context"
	"database/sql"
)

// ActivateEmpty creates an active encrypted account only from an explicitly
// pending new account. It cannot convert a v2 account or discard old data.
func (s *Store) ActivateEmpty(ctx context.Context, uid string, raw []byte) (AccountStatus, error) {
	var out AccountStatus
	c, err := parseMigrationControl(raw, "activate-empty")
	if err != nil || len(c.parameters) != 0 || !validAccount(uid) {
		return out, ErrInvalid
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	var user uint64
	var mode string
	var epoch sql.NullString
	var seq, minimum uint64
	err = tx.QueryRowContext(ctx, "SELECT id,mode,epoch,last_seq,min_available_seq FROM sync_users WHERE uid=? FOR UPDATE", uid).
		Scan(&user, &mode, &epoch, &seq, &minimum)
	if err == sql.ErrNoRows {
		return out, ErrForbidden
	}
	if err != nil {
		return out, err
	}
	var vaultMode, vaultEpoch string
	var revision, generation uint64
	var head []byte
	err = tx.QueryRowContext(ctx, "SELECT mode,epoch,membership_revision,current_key_generation,membership_head FROM vaults WHERE vault_id=? AND account_id=? FOR UPDATE", c.vaultID, uid).
		Scan(&vaultMode, &vaultEpoch, &revision, &generation, &head)
	if err == sql.ErrNoRows {
		return out, ErrNotFound
	}
	if err != nil {
		return out, err
	}
	var signing []byte
	var role string
	var authorizer bool
	err = tx.QueryRowContext(ctx, "SELECT signing_public_key,role,can_authorize_devices FROM vault_devices WHERE vault_id=? AND device_id=? AND revoked_revision IS NULL", c.vaultID, c.deviceID).
		Scan(&signing, &role, &authorizer)
	if err == sql.ErrNoRows || role != "write" || !authorizer {
		return out, ErrForbidden
	}
	if err != nil {
		return out, err
	}
	if err = c.record.Verify(signing, "migration"); err != nil {
		return out, err
	}
	if c.epoch != vaultEpoch || c.revision != revision || c.generation != generation {
		return out, ErrConflict
	}
	if mode == "e2ee" && vaultMode == "active" {
		out = AccountStatus{VaultID: c.vaultID, AccountMode: "e2ee", VaultMode: "active",
			Epoch: vaultEpoch, KeyGeneration: generation, Revision: revision, Head: HeadString(head)}
		return out, tx.Commit()
	}
	if mode != "e2ee_pending" || vaultMode != "pending" || epoch.Valid || seq != 0 || minimum != 1 {
		return out, ErrConflict
	}
	// A corrupt or manually altered pending account must never hide plaintext.
	for _, source := range []struct {
		query string
		arg   interface{}
	}{
		{"SELECT EXISTS(SELECT 1 FROM blocks WHERE uid=?)", uid},
		{"SELECT EXISTS(SELECT 1 FROM transactions WHERE `from`=?)", uid},
		{"SELECT EXISTS(SELECT 1 FROM tasks WHERE user_id=?)", user},
		{"SELECT EXISTS(SELECT 1 FROM categories WHERE user_id=?)", user},
		{"SELECT EXISTS(SELECT 1 FROM subtasks WHERE user_id=?)", user},
		{"SELECT EXISTS(SELECT 1 FROM task_categories WHERE user_id=?)", user},
		{"SELECT EXISTS(SELECT 1 FROM sync_devices WHERE user_id=?)", user},
		{"SELECT EXISTS(SELECT 1 FROM sync_change_log WHERE user_id=?)", user},
		{"SELECT EXISTS(SELECT 1 FROM sync_receipts WHERE user_id=?)", user},
		{"SELECT EXISTS(SELECT 1 FROM sync_occurrences WHERE user_id=?)", user},
		{"SELECT EXISTS(SELECT 1 FROM sync_snapshots WHERE user_id=?)", user},
		{"SELECT EXISTS(SELECT 1 FROM sync_backfills WHERE user_id=?)", user},
		{"SELECT EXISTS(SELECT 1 FROM encrypted_objects WHERE vault_id=?)", c.vaultID},
		{"SELECT EXISTS(SELECT 1 FROM encrypted_changes WHERE vault_id=?)", c.vaultID},
		{"SELECT EXISTS(SELECT 1 FROM encrypted_receipts WHERE vault_id=?)", c.vaultID},
	} {
		var exists bool
		if err = tx.QueryRowContext(ctx, source.query, source.arg).Scan(&exists); err != nil {
			return out, err
		}
		if exists {
			return out, ErrConflict
		}
	}
	if _, err = tx.ExecContext(ctx, "UPDATE vaults SET mode='active' WHERE vault_id=?", c.vaultID); err != nil {
		return out, err
	}
	if _, err = tx.ExecContext(ctx, "UPDATE sync_users SET mode='e2ee' WHERE id=?", user); err != nil {
		return out, err
	}
	out = AccountStatus{VaultID: c.vaultID, AccountMode: "e2ee", VaultMode: "active",
		Epoch: vaultEpoch, KeyGeneration: generation, Revision: revision, Head: HeadString(head)}
	return out, tx.Commit()
}
