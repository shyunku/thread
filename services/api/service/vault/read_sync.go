package vault

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"strconv"
	"time"
)

type Change struct {
	Record []byte     `json:"record"`
	Result PushResult `json:"result"`
}
type Changes struct {
	Until   string   `json:"until"`
	Next    string   `json:"next"`
	More    bool     `json:"more"`
	Changes []Change `json:"changes"`
}

func (s *Store) Pull(ctx context.Context, uid, epoch string, after, until uint64) (Changes, error) {
	if !validAccount(uid) {
		return Changes{}, ErrForbidden
	}
	tx, e := s.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if e != nil {
		return Changes{}, e
	}
	defer tx.Rollback()
	var id, currentEpoch, mode string
	var high uint64
	e = tx.QueryRowContext(ctx, `SELECT v.vault_id,v.epoch,v.mode,COALESCE(s.last_seq,0) FROM vaults v LEFT JOIN vault_sync s ON v.vault_id=s.vault_id WHERE v.account_id=?`, uid).Scan(&id, &currentEpoch, &mode, &high)
	if e == sql.ErrNoRows {
		return Changes{}, ErrNotFound
	}
	if e != nil {
		return Changes{}, e
	}
	if mode != "active" {
		return Changes{}, ErrInactive
	}
	if epoch != currentEpoch || after > high {
		return Changes{}, ErrConflict
	}
	if until == 0 {
		until = high
	}
	if until > high || after > until {
		return Changes{}, ErrConflict
	}
	result := Changes{strconv.FormatUint(until, 10), strconv.FormatUint(after, 10), false, make([]Change, 0)}
	rows, e := tx.QueryContext(ctx, `SELECT seq,signed_record,result FROM encrypted_changes WHERE vault_id=? AND seq>? AND seq<=? ORDER BY seq LIMIT 32`, id, after, until)
	if e != nil {
		return Changes{}, e
	}
	size := 0
	next := after
	for rows.Next() {
		var seq uint64
		var raw, encoded []byte
		if e = rows.Scan(&seq, &raw, &encoded); e != nil {
			rows.Close()
			return Changes{}, e
		}
		if size > 0 && size+len(raw) > 4*MaxBytes {
			break
		}
		if seq != next+1 {
			rows.Close()
			return Changes{}, ErrConflict
		}
		var receipt PushResult
		if e = json.Unmarshal(encoded, &receipt); e != nil {
			rows.Close()
			return Changes{}, e
		}
		result.Changes = append(result.Changes, Change{raw, receipt})
		size += len(raw)
		next = seq
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return Changes{}, e
	}
	result.Next = strconv.FormatUint(next, 10)
	result.More = next < until
	if next == after && result.More {
		return Changes{}, ErrConflict
	}
	return result, tx.Commit()
}

type Snapshot struct {
	ID      string `json:"id"`
	Epoch   string `json:"epoch"`
	Seq     string `json:"seq"`
	Head    string `json:"membershipHead"`
	Digest  string `json:"digest"`
	Count   uint64 `json:"count"`
	Expires int64  `json:"expiresAt"`
}
type SnapshotObject struct {
	ID      string `json:"objectId"`
	Version string `json:"version"`
	Seq     string `json:"seq"`
	Deleted bool   `json:"deleted"`
	Index   uint64 `json:"operationIndex"`
	Record  []byte `json:"record"`
}
type SnapshotPage struct {
	Next    string           `json:"next"`
	More    bool             `json:"more"`
	Objects []SnapshotObject `json:"objects"`
}

func (s *Store) Snapshot(ctx context.Context, uid string) (Snapshot, error) {
	if !validAccount(uid) {
		return Snapshot{}, ErrForbidden
	}
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return Snapshot{}, e
	}
	defer tx.Rollback()
	var id, epoch, mode string
	var head []byte
	var seq uint64
	e = tx.QueryRowContext(ctx, `SELECT vault_id,epoch,mode,membership_head FROM vaults WHERE account_id=? FOR UPDATE`, uid).Scan(&id, &epoch, &mode, &head)
	if e == sql.ErrNoRows {
		return Snapshot{}, ErrNotFound
	}
	if e != nil {
		return Snapshot{}, e
	}
	if mode != "active" {
		return Snapshot{}, ErrInactive
	}
	e = tx.QueryRowContext(ctx, `SELECT last_seq FROM vault_sync WHERE vault_id=?`, id).Scan(&seq)
	if e != nil && e != sql.ErrNoRows {
		return Snapshot{}, e
	}
	rows, e := tx.QueryContext(ctx, `SELECT object_id,version,seq,deleted,operation_index,signed_record FROM encrypted_objects WHERE vault_id=? ORDER BY object_id`, id)
	if e != nil {
		return Snapshot{}, e
	}
	h := sha256.New()
	count := uint64(0)
	for rows.Next() {
		var objectID string
		var version, objectSeq, index uint64
		var deleted bool
		var raw []byte
		if e = rows.Scan(&objectID, &version, &objectSeq, &deleted, &index, &raw); e != nil {
			rows.Close()
			return Snapshot{}, e
		}
		sum := sha256.Sum256(raw)
		encoded, e := Encode([]interface{}{objectID, strconv.FormatUint(version, 10), strconv.FormatUint(objectSeq, 10), deleted, index, sum[:]})
		if e != nil {
			rows.Close()
			return Snapshot{}, e
		}
		h.Write(encoded)
		count++
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return Snapshot{}, e
	}
	digest := h.Sum(nil)
	snapshotID := uuid.NewString()
	expires := time.Now().Add(24 * time.Hour).Unix()
	_, e = tx.ExecContext(ctx, `INSERT INTO encrypted_snapshots(id,vault_id,epoch,seq,membership_head,manifest_digest,object_count,expires_at) VALUES(?,?,?,?,?,?,?,?)`, snapshotID, id, epoch, seq, head, digest, count, expires)
	if e != nil {
		return Snapshot{}, e
	}
	_, e = tx.ExecContext(ctx, `INSERT INTO encrypted_snapshot_objects(snapshot_id,object_id,version,seq,deleted,operation_index,signed_record) SELECT ?,object_id,version,seq,deleted,operation_index,signed_record FROM encrypted_objects WHERE vault_id=?`, snapshotID, id)
	if e != nil {
		return Snapshot{}, e
	}
	return Snapshot{snapshotID, epoch, strconv.FormatUint(seq, 10), HeadString(head), HeadString(digest), count, expires}, tx.Commit()
}
func (s *Store) SnapshotPage(ctx context.Context, uid, id, after string) (SnapshotPage, error) {
	if !validAccount(uid) || len(id) != 36 || (after != "" && !identifier.MatchString(after)) {
		return SnapshotPage{}, ErrInvalid
	}
	var exists int
	e := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM encrypted_snapshots s JOIN vaults v ON s.vault_id=v.vault_id WHERE s.id=? AND v.account_id=? AND s.expires_at>? AND v.mode='active' AND v.epoch=s.epoch`, id, uid, time.Now().Unix()).Scan(&exists)
	if e != nil {
		return SnapshotPage{}, e
	}
	if exists != 1 {
		return SnapshotPage{}, ErrNotFound
	}
	rows, e := s.DB.QueryContext(ctx, `SELECT object_id,version,seq,deleted,operation_index,signed_record FROM encrypted_snapshot_objects WHERE snapshot_id=? AND object_id>? ORDER BY object_id LIMIT 33`, id, after)
	if e != nil {
		return SnapshotPage{}, e
	}
	defer rows.Close()
	result := SnapshotPage{after, false, make([]SnapshotObject, 0)}
	size := 0
	for rows.Next() {
		var o SnapshotObject
		var version, seq uint64
		if e = rows.Scan(&o.ID, &version, &seq, &o.Deleted, &o.Index, &o.Record); e != nil {
			return SnapshotPage{}, e
		}
		if len(result.Objects) == 32 || (size > 0 && size+len(o.Record) > 4*MaxBytes) {
			result.More = true
			break
		}
		o.Version = strconv.FormatUint(version, 10)
		o.Seq = strconv.FormatUint(seq, 10)
		result.Objects = append(result.Objects, o)
		result.Next = o.ID
		size += len(o.Record)
	}
	return result, rows.Err()
}
