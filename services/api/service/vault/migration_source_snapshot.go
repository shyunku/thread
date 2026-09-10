package vault

import (
	"context"
	"crypto/rand"
	"database/sql"
	"strconv"
	"thread_api/service/canonical"
	"time"
)

// This endpoint returns checkpoint metadata only. Source pages remain behind
// signed prepare/source and its recorded coordinator. It never freezes an account.
type MigrationSourceSnapshot struct {
	ID        string `json:"snapshotId"`
	Epoch     string `json:"epoch"`
	Seq       string `json:"seq"`
	PageCount int    `json:"pageCount"`
}

func (s *Store) CreateMigrationSourceSnapshot(ctx context.Context, uid string, raw []byte) (MigrationSourceSnapshot, error) {
	var out MigrationSourceSnapshot
	c, e := parseMigrationControl(raw, "source-snapshot")
	if e != nil {
		return out, e
	}
	if _, e = migrationID(c.parameters); e != nil || len(c.parameters) != 1 {
		return out, ErrInvalid
	}
	tx, l, e := s.lockMigration(ctx, uid, c)
	if e != nil {
		return out, e
	}
	defer tx.Rollback()
	if l.mode != "v2" || l.vaultMode != "pending" || l.vaultEpoch != c.epoch || l.revision != c.revision || l.generation != c.generation {
		return out, ErrConflict
	}
	out.Epoch, out.Seq = l.sourceEpoch, strconv.FormatUint(l.seq, 10)
	// Reuse an unexpired exact checkpoint after a lost response, without
	// consuming the ordinary snapshot quota on each reconnect.
	e = tx.QueryRowContext(ctx, "SELECT id,page_count FROM sync_snapshots WHERE user_id=? AND epoch=? AND seq=? AND expires_at>? ORDER BY expires_at DESC LIMIT 1",
		l.user, l.sourceEpoch, l.seq, time.Now().UnixMilli()).Scan(&out.ID, &out.PageCount)
	if e == nil {
		return out, tx.Commit()
	}
	if e != sql.ErrNoRows {
		return out, e
	}
	key := make([]byte, 32)
	if _, e = rand.Read(key); e != nil {
		return out, e
	}
	p := canonical.Protocol{Store: &canonical.Store{DB: s.DB}, Key: key, Enabled: true}
	snapshot, e := p.SnapshotInTransaction(ctx, tx, uid, l.sourceEpoch)
	if e != nil {
		switch canonical.ErrorCode(e) {
		case "SNAPSHOT_LIMIT":
			return out, ErrQuota
		case "SNAPSHOT_TOO_LARGE", "SNAPSHOT_ENTITY_TOO_LARGE":
			return out, ErrMigrationSourceLimit
		}
		return out, e
	}
	// The temporary cursor is never exported or accepted by v2.
	out = MigrationSourceSnapshot{snapshot.ID, snapshot.Epoch, snapshot.Seq, snapshot.PageCount}
	return out, tx.Commit()
}
