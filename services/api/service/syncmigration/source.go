package syncmigration

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

// ReadSource uses a single consistent, read-only transaction and the persisted DB,
// never the legacy in-memory chain cache. Only the latest State blob is loaded.
func ReadSource(ctx context.Context, db *sql.DB, uid string) (Source, error) {
	source := Source{UserID: uid, Blocks: []BlockMeta{}}
	if !validID(uid) {
		return source, fmt.Errorf("INVALID_USER_ID")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return source, fmt.Errorf("READ_ONLY_SNAPSHOT_UNAVAILABLE")
	}
	defer tx.Rollback()
	var exists int
	if e := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM user_master WHERE uid=?", uid).Scan(&exists); e != nil || exists != 1 {
		return source, fmt.Errorf("USER_NOT_FOUND_OR_AMBIGUOUS")
	}
	query := "SELECT b.block_number,b.block_hash,b.tx_hash,t.`from`,t.version,t.type,t.timestamp,t.content FROM blocks b LEFT JOIN transactions t ON t.hash=b.tx_hash WHERE b.uid=? ORDER BY b.block_number"
	rows, err := tx.QueryContext(ctx, query, uid)
	if err != nil {
		return source, fmt.Errorf("BLOCK_METADATA_READ_FAILED")
	}
	for rows.Next() {
		if len(source.Blocks) >= 250000 {
			rows.Close()
			return source, fmt.Errorf("LEGACY_HISTORY_LIMIT")
		}
		var number, version, kind, timestamp sql.NullInt64
		var blockHash, txHash, owner sql.NullString
		var content []byte
		if e := rows.Scan(&number, &blockHash, &txHash, &owner, &version, &kind, &timestamp, &content); e != nil {
			rows.Close()
			return source, fmt.Errorf("BLOCK_METADATA_SCAN_FAILED")
		}
		if !number.Valid || !version.Valid || !kind.Valid || !owner.Valid || !timestamp.Valid || !blockHash.Valid || !txHash.Valid {
			rows.Close()
			return source, fmt.Errorf("MISSING_BLOCK_TRANSACTION")
		}
		encoded, _ := json.Marshal(struct {
			Version, Type, Timestamp int64
			Content                  []byte
		}{version.Int64, kind.Int64, timestamp.Int64, content})
		source.Blocks = append(source.Blocks, BlockMeta{number.Int64, blockHash.String, txHash.String, owner.String, int(version.Int64), kind.Int64, digest(encoded)})
		source.SnapshotNumber = number.Int64
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return source, fmt.Errorf("BLOCK_METADATA_READ_FAILED")
	}
	if len(source.Blocks) == 0 {
		source.Snapshot = json.RawMessage(`{"tasks":{},"categories":{}}`)
	} else {
		var count int
		var size sql.NullInt64
		err = tx.QueryRowContext(ctx, "SELECT COUNT(*),MAX(OCTET_LENGTH(state)) FROM blocks WHERE uid=? AND block_number=?", uid, source.SnapshotNumber).Scan(&count, &size)
		if err != nil || count != 1 {
			return source, fmt.Errorf("DUPLICATE_OR_MISSING_LATEST_BLOCK")
		}
		if !size.Valid || size.Int64 <= 0 || size.Int64 > MaxSnapshotBytes {
			return source, fmt.Errorf("INVALID_SNAPSHOT_SIZE")
		}
		if err = tx.QueryRowContext(ctx, "SELECT state FROM blocks WHERE uid=? AND block_number=?", uid, source.SnapshotNumber).Scan(&source.Snapshot); err != nil {
			return source, fmt.Errorf("SNAPSHOT_READ_FAILED")
		}
	}
	if err = tx.Commit(); err != nil {
		return source, fmt.Errorf("READ_ONLY_SNAPSHOT_FAILED")
	}
	return source, nil
}
