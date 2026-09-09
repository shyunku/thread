package vault

import (
	"context"
	"database/sql"
	"time"
)

// Read proofs are short lived and operation/parameter-bound. Replaying a read
// within its lifetime is harmless; snapshot creation is deduplicated and bounded.
type readProof struct {
	vaultID, deviceID, epoch string
	revision, generation     uint64
	parameters               map[string]interface{}
}
type readProofKey struct{}

type Envelope struct {
	Record     []byte `json:"record"`
	Generation uint64 `json:"keyGeneration"`
}

func (s *Store) SignedEnvelope(ctx context.Context, uid string, raw []byte) (Envelope, error) {
	ctx, p, err := s.authorizeRead(ctx, uid, raw, "envelope")
	if err != nil {
		return Envelope{}, err
	}
	generation, ok := p.parameters["keyGeneration"].(uint64)
	if len(p.parameters) != 1 || !ok || generation < 1 || generation > p.generation {
		return Envelope{}, ErrInvalid
	}
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return Envelope{}, err
	}
	defer tx.Rollback()
	if err = checkReadProof(ctx, tx, p.vaultID); err != nil {
		return Envelope{}, err
	}
	result := Envelope{Generation: generation}
	err = tx.QueryRowContext(ctx, `SELECT signed_envelope FROM vault_key_envelopes WHERE vault_id=? AND recipient_device_id=? AND key_generation=?`, p.vaultID, p.deviceID, generation).Scan(&result.Record)
	if err == sql.ErrNoRows {
		return Envelope{}, ErrNotFound
	}
	if err != nil {
		return Envelope{}, err
	}
	return result, tx.Commit()
}

func (s *Store) authorizeRead(ctx context.Context, uid string, raw []byte, operation string) (context.Context, readProof, error) {
	var proof readProof
	if !validAccount(uid) {
		return ctx, proof, ErrForbidden
	}
	r, err := ParseRecord(raw)
	if err != nil {
		return ctx, proof, err
	}
	b := r.Body
	proof.vaultID, _ = b["vaultId"].(string)
	proof.deviceID, _ = b["deviceId"].(string)
	proof.epoch, _ = b["epoch"].(string)
	var revisionOK, generationOK bool
	proof.revision, revisionOK = b["membershipRevision"].(uint64)
	proof.generation, generationOK = b["keyGeneration"].(uint64)
	proof.parameters, _ = b["parameters"].(map[string]interface{})
	expiry, ok := b["expiresAt"].(uint64)
	requestID, _ := b["requestId"].(string)
	now := uint64(time.Now().UnixMilli())
	if len(b) != 10 || b["schema"] != uint64(1) || b["operation"] != operation ||
		!identifier.MatchString(proof.vaultID) || !identifier.MatchString(proof.deviceID) ||
		!identifier.MatchString(requestID) || !identifier.MatchString(proof.epoch) ||
		proof.parameters == nil || !revisionOK || !generationOK || proof.generation == 0 || !ok || expiry <= now || expiry > now+300000 {
		return ctx, proof, ErrInvalid
	}
	var key []byte
	var revision, generation uint64
	var epoch, mode string
	err = s.DB.QueryRowContext(ctx, `SELECT d.signing_public_key,v.membership_revision,v.current_key_generation,v.epoch,v.mode
 FROM vaults v JOIN vault_devices d ON d.vault_id=v.vault_id
 WHERE v.vault_id=? AND v.account_id=? AND d.device_id=? AND d.revoked_revision IS NULL`,
		proof.vaultID, uid, proof.deviceID).Scan(&key, &revision, &generation, &epoch, &mode)
	if err == sql.ErrNoRows {
		return ctx, proof, ErrForbidden
	}
	if err != nil {
		return ctx, proof, err
	}
	if err = r.Verify(key, "request"); err != nil {
		return ctx, proof, err
	}
	if mode != "active" {
		return ctx, proof, ErrInactive
	}
	if epoch != proof.epoch || revision != proof.revision || generation != proof.generation {
		return ctx, proof, ErrConflict
	}
	return context.WithValue(ctx, readProofKey{}, proof), proof, nil
}

// Recheck authorization in the same database snapshot used to read ciphertext.
// Internal Store callers can omit a proof; every public sync read supplies one.
func checkReadProof(ctx context.Context, tx *sql.Tx, vaultID string) error {
	proof, ok := ctx.Value(readProofKey{}).(readProof)
	if !ok {
		return nil
	}
	var count int
	err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM vaults v JOIN vault_devices d ON v.vault_id=d.vault_id
 WHERE v.vault_id=? AND v.vault_id=? AND d.device_id=? AND d.revoked_revision IS NULL
 AND v.mode='active' AND v.epoch=? AND v.membership_revision=? AND v.current_key_generation=?`,
		vaultID, proof.vaultID, proof.deviceID, proof.epoch, proof.revision, proof.generation).Scan(&count)
	if err != nil {
		return err
	}
	if count != 1 {
		return ErrForbidden
	}
	return nil
}

func (s *Store) SignedPull(ctx context.Context, uid string, raw []byte) (Changes, error) {
	ctx, p, err := s.authorizeRead(ctx, uid, raw, "pull")
	if err != nil {
		return Changes{}, err
	}
	after, aok := decimal(p.parameters["after"], false)
	until, uok := decimal(p.parameters["until"], false)
	if len(p.parameters) != 2 || !aok || !uok {
		return Changes{}, ErrInvalid
	}
	return s.Pull(ctx, uid, p.epoch, after, until)
}
func (s *Store) SignedSnapshot(ctx context.Context, uid string, raw []byte) (Snapshot, error) {
	ctx, p, err := s.authorizeRead(ctx, uid, raw, "snapshot")
	if err != nil {
		return Snapshot{}, err
	}
	if len(p.parameters) != 0 {
		return Snapshot{}, ErrInvalid
	}
	return s.Snapshot(ctx, uid)
}
func (s *Store) SignedSnapshotPage(ctx context.Context, uid string, raw []byte) (SnapshotPage, error) {
	ctx, p, err := s.authorizeRead(ctx, uid, raw, "snapshot-page")
	if err != nil {
		return SnapshotPage{}, err
	}
	id, iok := p.parameters["snapshotId"].(string)
	after, aok := p.parameters["after"].(string)
	if len(p.parameters) != 2 || !iok || !aok {
		return SnapshotPage{}, ErrInvalid
	}
	return s.SnapshotPage(ctx, uid, id, after)
}
