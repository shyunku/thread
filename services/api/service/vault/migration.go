package vault

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"time"

	"github.com/google/uuid"
)

var ErrMigrationSourceLimit = errors.New("MIGRATION_SOURCE_LIMIT")

type MigrationStatus struct {
	ID             string `json:"id"`
	VaultID        string `json:"vaultId"`
	Coordinator    string `json:"coordinator"`
	SourceEpoch    string `json:"sourceEpoch"`
	SourceSnapshot string `json:"sourceSnapshotId"`
	FreezeSeq      string `json:"freezeSeq"`
	TargetEpoch    string `json:"targetEpoch"`
	Phase          string `json:"phase"`
	PageCount      uint64 `json:"pageCount"`
	ObjectCount    uint64 `json:"objectCount"`
}
type MigrationSourcePage struct {
	Payload  string `json:"payload"`
	Checksum string `json:"checksum"`
}
type migrationControl struct {
	record                   Record
	vaultID, deviceID, epoch string
	revision, generation     uint64
	parameters               map[string]interface{}
}

func parseMigrationControl(raw []byte, operation string) (migrationControl, error) {
	var c migrationControl
	r, e := ParseRecord(raw)
	if e != nil {
		return c, e
	}
	c.record = r
	b := r.Body
	c.vaultID, _ = b["vaultId"].(string)
	c.deviceID, _ = b["deviceId"].(string)
	c.epoch, _ = b["epoch"].(string)
	var rok, gok bool
	c.revision, rok = b["membershipRevision"].(uint64)
	c.generation, gok = b["keyGeneration"].(uint64)
	c.parameters, _ = b["parameters"].(map[string]interface{})
	id, _ := b["requestId"].(string)
	expires, ok := b["expiresAt"].(uint64)
	now := uint64(time.Now().UnixMilli())
	if len(b) != 10 || b["schema"] != uint64(1) || b["operation"] != operation || !identifier.MatchString(c.vaultID) || !identifier.MatchString(c.deviceID) || !identifier.MatchString(c.epoch) || !identifier.MatchString(id) || !rok || !gok || c.generation == 0 || c.parameters == nil || !ok || expires <= now || expires > now+300000 {
		return c, ErrInvalid
	}
	return c, nil
}

type migrationLocks struct {
	user                                     uint64
	mode, sourceEpoch, vaultMode, vaultEpoch string
	seq, revision, generation                uint64
}

func (s *Store) lockMigration(ctx context.Context, uid string, c migrationControl) (*sql.Tx, migrationLocks, error) {
	var l migrationLocks
	if !validAccount(uid) {
		return nil, l, ErrForbidden
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return nil, l, e
	}
	fail := func(err error) (*sql.Tx, migrationLocks, error) {
		tx.Rollback()
		if err == sql.ErrNoRows {
			err = ErrForbidden
		}
		return nil, l, err
	}
	// Same first lock as every v2 mutation: a push either finishes before freeze
	// (and changes freezeSeq), or observes the frozen mode after it.
	e = tx.QueryRowContext(ctx, `SELECT id,mode,epoch,last_seq FROM sync_users WHERE uid=? FOR UPDATE`, uid).Scan(&l.user, &l.mode, &l.sourceEpoch, &l.seq)
	if e != nil {
		return fail(e)
	}
	e = tx.QueryRowContext(ctx, `SELECT mode,epoch,membership_revision,current_key_generation FROM vaults WHERE vault_id=? AND account_id=? FOR UPDATE`, c.vaultID, uid).Scan(&l.vaultMode, &l.vaultEpoch, &l.revision, &l.generation)
	if e != nil {
		return fail(e)
	}
	var key []byte
	var role string
	var authorizer bool
	e = tx.QueryRowContext(ctx, `SELECT signing_public_key,role,can_authorize_devices FROM vault_devices WHERE vault_id=? AND device_id=? AND revoked_revision IS NULL`, c.vaultID, c.deviceID).Scan(&key, &role, &authorizer)
	if e != nil {
		return fail(e)
	}
	if role != "write" || !authorizer {
		return fail(ErrForbidden)
	}
	if e = c.record.Verify(key, "migration"); e != nil {
		return fail(e)
	}
	return tx, l, nil
}
func migrationStatus(ctx context.Context, tx *sql.Tx, id, vaultID, deviceID string) (MigrationStatus, error) {
	var r MigrationStatus
	e := tx.QueryRowContext(ctx, `SELECT migration_id,vault_id,coordinator,source_epoch,source_snapshot,freeze_seq,target_epoch,phase,page_count,object_count FROM vault_migrations WHERE migration_id=? AND vault_id=? AND coordinator=?`, id, vaultID, deviceID).Scan(&r.ID, &r.VaultID, &r.Coordinator, &r.SourceEpoch, &r.SourceSnapshot, &r.FreezeSeq, &r.TargetEpoch, &r.Phase, &r.PageCount, &r.ObjectCount)
	if e == sql.ErrNoRows {
		return r, ErrNotFound
	}
	return r, e
}
func migrationID(p map[string]interface{}) (string, error) {
	id, _ := p["migrationId"].(string)
	if !identifier.MatchString(id) {
		return "", ErrInvalid
	}
	return id, nil
}
func (s *Store) PrepareMigration(ctx context.Context, uid string, raw []byte) (MigrationStatus, error) {
	var out MigrationStatus
	c, e := parseMigrationControl(raw, "prepare")
	if e != nil {
		return out, e
	}
	id, e := migrationID(c.parameters)
	if e != nil {
		return out, e
	}
	sourceEpoch, _ := c.parameters["sourceEpoch"].(string)
	snapshotID, _ := c.parameters["sourceSnapshotId"].(string)
	freeze, ok := decimal(c.parameters["freezeSeq"], false)
	parsed, e := uuid.Parse(snapshotID)
	if len(c.parameters) != 4 || !ok || e != nil || parsed.String() != snapshotID {
		return out, ErrInvalid
	}
	tx, l, e := s.lockMigration(ctx, uid, c)
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	prior, e := migrationStatus(ctx, tx, id, c.vaultID, c.deviceID)
	if e == nil {
		if prior.SourceEpoch != sourceEpoch || prior.SourceSnapshot != snapshotID || prior.FreezeSeq != strconv.FormatUint(freeze, 10) {
			return out, ErrConflict
		}
		// Retry/status queries work even if the source snapshot has since expired.
		return prior, tx.Commit()
	}
	if e != ErrNotFound {
		return out, e
	}
	if l.mode != "v2" || l.vaultMode != "pending" || l.sourceEpoch != sourceEpoch || l.seq != freeze || l.vaultEpoch != c.epoch || l.revision != c.revision || l.generation != c.generation {
		return out, ErrConflict
	}
	var pageCount uint64
	e = tx.QueryRowContext(ctx, `SELECT page_count FROM sync_snapshots WHERE user_id=? AND id=? AND epoch=? AND seq=? AND expires_at>?`, l.user, snapshotID, sourceEpoch, freeze, time.Now().UnixMilli()).Scan(&pageCount)
	if e == sql.ErrNoRows {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	var actual, minimum, maximum, total, largest, objects uint64
	e = tx.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(MIN(page_number),0),COALESCE(MAX(page_number),0),COALESCE(SUM(OCTET_LENGTH(payload)),0),COALESCE(MAX(OCTET_LENGTH(payload)),0),
 COALESCE(SUM(CASE WHEN JSON_TYPE(JSON_EXTRACT(CAST(CONVERT(payload USING utf8mb4) AS JSON),'$.changes'))='ARRAY'
 THEN JSON_LENGTH(CAST(CONVERT(payload USING utf8mb4) AS JSON),'$.changes') ELSE 0 END),0)
 FROM sync_snapshot_pages WHERE user_id=? AND snapshot_id=?`, l.user, snapshotID).Scan(&actual, &minimum, &maximum, &total, &largest, &objects)
	if e != nil {
		return out, e
	}
	if actual != pageCount || pageCount == 0 || minimum != 0 || maximum != pageCount-1 {
		return out, ErrConflict
	}
	if total > 128*1024*1024 || largest > 4*1024*1024 || objects > 1000000 {
		return out, ErrMigrationSourceLimit
	}
	var staged uint64
	e = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM encrypted_objects WHERE vault_id=?`, c.vaultID).Scan(&staged)
	if e != nil {
		return out, e
	}
	if staged != 0 {
		return out, ErrConflict
	}
	out = MigrationStatus{id, c.vaultID, c.deviceID, sourceEpoch, snapshotID, strconv.FormatUint(freeze, 10), uuid.NewString(), "FROZEN", pageCount, objects}
	_, e = tx.ExecContext(ctx, `INSERT INTO vault_migrations(migration_id,vault_id,source_user,coordinator,source_epoch,source_snapshot,freeze_seq,prior_vault_epoch,target_epoch,phase,page_count,object_count,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, c.vaultID, l.user, c.deviceID, sourceEpoch, snapshotID, freeze, l.vaultEpoch, out.TargetEpoch, out.Phase, pageCount, objects, time.Now().UnixMilli())
	if e != nil {
		return MigrationStatus{}, conflict(e)
	}
	_, e = tx.ExecContext(ctx, `INSERT INTO vault_migration_active(vault_id,migration_id) VALUES(?,?)`, c.vaultID, id)
	if e != nil {
		return MigrationStatus{}, conflict(e)
	}
	_, e = tx.ExecContext(ctx, `INSERT INTO vault_migration_source_pages(migration_id,page_number,payload,checksum) SELECT ?,page_number,payload,checksum FROM sync_snapshot_pages WHERE user_id=? AND snapshot_id=?`, id, l.user, snapshotID)
	if e != nil {
		return MigrationStatus{}, e
	}
	_, e = tx.ExecContext(ctx, `UPDATE sync_users SET mode='e2ee_frozen' WHERE id=?`, l.user)
	if e != nil {
		return MigrationStatus{}, e
	}
	_, e = tx.ExecContext(ctx, `UPDATE vaults SET mode='migrating',epoch=? WHERE vault_id=?`, out.TargetEpoch, c.vaultID)
	if e != nil {
		return MigrationStatus{}, e
	}
	return out, tx.Commit()
}
func (s *Store) MigrationStatus(ctx context.Context, uid string, raw []byte) (MigrationStatus, error) {
	var out MigrationStatus
	c, e := parseMigrationControl(raw, "status")
	if e != nil {
		return out, e
	}
	id, e := migrationID(c.parameters)
	if e != nil || len(c.parameters) != 1 {
		return out, ErrInvalid
	}
	tx, _, e := s.lockMigration(ctx, uid, c)
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	out, e = migrationStatus(ctx, tx, id, c.vaultID, c.deviceID)
	if e != nil {
		return out, e
	}
	return out, tx.Commit()
}
func (s *Store) MigrationSource(ctx context.Context, uid string, raw []byte) (MigrationSourcePage, error) {
	var out MigrationSourcePage
	c, e := parseMigrationControl(raw, "source-page")
	if e != nil {
		return out, e
	}
	id, e := migrationID(c.parameters)
	page, ok := c.parameters["page"].(uint64)
	if e != nil || !ok || len(c.parameters) != 2 {
		return out, ErrInvalid
	}
	tx, l, e := s.lockMigration(ctx, uid, c)
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	status, e := migrationStatus(ctx, tx, id, c.vaultID, c.deviceID)
	if e != nil {
		return out, e
	}
	if status.Phase != "FROZEN" || l.mode != "e2ee_frozen" || l.vaultMode != "migrating" || l.vaultEpoch != status.TargetEpoch || page >= status.PageCount {
		return out, ErrConflict
	}
	e = tx.QueryRowContext(ctx, `SELECT payload,checksum FROM vault_migration_source_pages WHERE migration_id=? AND page_number=?`, id, page).Scan(&out.Payload, &out.Checksum)
	if e != nil {
		return out, e
	}
	return out, tx.Commit()
}
func (s *Store) CancelMigration(ctx context.Context, uid string, raw []byte) (MigrationStatus, error) {
	var out MigrationStatus
	c, e := parseMigrationControl(raw, "cancel")
	if e != nil {
		return out, e
	}
	id, e := migrationID(c.parameters)
	if e != nil || len(c.parameters) != 1 {
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
	if out.Phase == "CANCELLED" {
		return out, tx.Commit()
	}
	if out.Phase != "FROZEN" || l.mode != "e2ee_frozen" || l.vaultMode != "migrating" || l.vaultEpoch != out.TargetEpoch {
		return out, ErrConflict
	}
	var active, previous string
	e = tx.QueryRowContext(ctx, `SELECT a.migration_id,m.prior_vault_epoch FROM vault_migration_active a JOIN vault_migrations m ON m.migration_id=a.migration_id WHERE a.vault_id=?`, c.vaultID).Scan(&active, &previous)
	if e != nil {
		return out, e
	}
	if active != id {
		return out, ErrConflict
	}
	// Upload/commit are not enabled yet. Never discard ciphertext using this
	// pre-upload cancellation path if a future writer has staged anything.
	var staged uint64
	e = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM encrypted_objects WHERE vault_id=?`, c.vaultID).Scan(&staged)
	if e != nil {
		return out, e
	}
	if staged != 0 {
		return out, ErrConflict
	}
	for _, query := range []string{`DELETE FROM vault_migration_source_pages WHERE migration_id=?`, `DELETE FROM vault_migration_active WHERE migration_id=?`, `UPDATE vault_migrations SET phase='CANCELLED' WHERE migration_id=?`} {
		if _, e = tx.ExecContext(ctx, query, id); e != nil {
			return out, e
		}
	}
	if _, e = tx.ExecContext(ctx, `UPDATE sync_users SET mode='v2' WHERE id=?`, l.user); e != nil {
		return out, e
	}
	if _, e = tx.ExecContext(ctx, `UPDATE vaults SET mode='pending',epoch=? WHERE vault_id=?`, previous, c.vaultID); e != nil {
		return out, e
	}
	out.Phase = "CANCELLED"
	return out, tx.Commit()
}
