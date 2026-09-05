package canonical

import (
	"context"
	"database/sql"
)

// WithLegacyFence holds the same row lock used by the migration cutover and
// v2 writers for the entire legacy handler, including multi-transaction bundles.
// The callback uses legacy persistence unchanged; this transaction owns the fence.
func WithLegacyFence(ctx context.Context, db *sql.DB, uid string, fn func() (interface{}, error)) (interface{}, error) {
	tx, e := db.BeginTx(ctx, nil)
	if e != nil {
		return nil, fail("SYNC_UNAVAILABLE")
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "INSERT INTO sync_users(uid) VALUES (?) ON DUPLICATE KEY UPDATE uid=VALUES(uid)", uid); e != nil {
		return nil, fail("SYNC_UNAVAILABLE")
	}
	a, e := account(ctx, tx, uid, " FOR UPDATE")
	if e != nil {
		return nil, fail("SYNC_UNAVAILABLE")
	}
	if a.Mode != "legacy" {
		return nil, fail("UPDATE_REQUIRED")
	}
	result, handlerErr := fn()
	// Persist a newly created metadata row even when a legacy handler rejects.
	if e = tx.Commit(); e != nil {
		return nil, fail("SYNC_UNAVAILABLE")
	}
	return result, handlerErr
}
