package vault

import (
	"context"
	"database/sql"
)

// Routing metadata only; never creates or migrates an account.
type AccountStatus struct {
	VaultID       string `json:"vaultId"`
	AccountMode   string `json:"accountMode"`
	VaultMode     string `json:"vaultMode"`
	Epoch         string `json:"epoch"`
	KeyGeneration uint64 `json:"keyGeneration"`
	Revision      uint64 `json:"revision"`
	Head          string `json:"head"`
}

func (s *Store) Status(ctx context.Context, uid string) (AccountStatus, error) {
	var result AccountStatus
	if !validAccount(uid) {
		return result, ErrForbidden
	}
	var head []byte
	err := s.DB.QueryRowContext(ctx, `SELECT v.vault_id,COALESCE(a.mode,'v2'),v.mode,v.epoch,v.current_key_generation,v.membership_revision,v.membership_head FROM vaults v LEFT JOIN sync_users a ON a.uid=v.account_id WHERE v.account_id=?`, uid).Scan(&result.VaultID, &result.AccountMode, &result.VaultMode, &result.Epoch, &result.KeyGeneration, &result.Revision, &head)
	if err == sql.ErrNoRows {
		return result, ErrNotFound
	}
	result.Head = HeadString(head)
	return result, err
}
