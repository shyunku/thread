package canonical

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"strconv"
	"strings"
	"time"
)

type Snapshot struct {
	ID        string `json:"snapshotId"`
	Epoch     string `json:"epoch"`
	Cursor    string `json:"cursor"`
	Seq       string `json:"seq"`
	PageCount int    `json:"pageCount"`
	ExpiresAt int64  `json:"expiresAt"`
}
type SnapshotPage struct {
	Payload  string `json:"payload"`
	Checksum string `json:"checksum"`
}

// Snapshot takes the same account lock as writers/prune before its first
// consistent read. All pages and the retention pin become visible together.
func (p *Protocol) Snapshot(ctx context.Context, uid, epoch string) (Snapshot, error) {
	result := Snapshot{}
	if len(p.Key) < 32 {
		return result, fail("SYNC_UNAVAILABLE")
	}
	tx, e := p.Store.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if e != nil {
		return result, e
	}
	defer tx.Rollback()
	a, e := account(ctx, tx, uid, " FOR UPDATE")
	if e != nil {
		return result, e
	}
	if e = p.ready(a, epoch); e != nil {
		return result, e
	}
	// Bound retained artifacts per account; expired artifacts only are removed.
	if _, e = tx.ExecContext(ctx, "DELETE p FROM sync_snapshot_pages p JOIN sync_snapshots s ON s.user_id=p.user_id AND s.id=p.snapshot_id WHERE s.user_id=? AND s.expires_at<=?", a.User, p.now().UnixMilli()); e != nil {
		return result, e
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM sync_snapshots WHERE user_id=? AND expires_at<=?", a.User, p.now().UnixMilli()); e != nil {
		return result, e
	}
	var active int
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM sync_snapshots WHERE user_id=?", a.User).Scan(&active); e != nil {
		return result, e
	}
	if active >= 4 {
		return result, fail("SNAPSHOT_LIMIT")
	}
	pages := [][]byte{}
	batch := []*Change{}
	bytesInBatch, total := 0, 0
	flush := func() error {
		raw, e := json.Marshal(struct {
			Changes []*Change `json:"changes"`
		}{batch})
		if e != nil {
			return e
		}
		total += len(raw)
		if total > 128*1024*1024 {
			return fail("SNAPSHOT_TOO_LARGE")
		}
		pages = append(pages, raw)
		batch = []*Change{}
		bytesInBatch = 0
		return nil
	}
	appendChange := func(c *Change) error {
		raw, e := json.Marshal(c)
		if e != nil {
			return e
		}
		if len(raw) > 16*1024*1024 {
			return fail("SNAPSHOT_ENTITY_TOO_LARGE")
		}
		if bytesInBatch+len(raw) > 1024*1024 && len(batch) > 0 {
			if e = flush(); e != nil {
				return e
			}
		}
		batch = append(batch, c)
		bytesInBatch += len(raw)
		return nil
	}
	for _, kind := range []string{"category", "task", "subtask", "taskCategory"} {
		if e = readSnapshotRows(ctx, tx, a.User, kind, appendChange); e != nil {
			return result, e
		}
	}
	if len(batch) > 0 || len(pages) == 0 {
		if e = flush(); e != nil {
			return result, e
		}
	}
	result = Snapshot{ID: uuid.NewString(), Epoch: epoch, Seq: a.Last, Cursor: p.Cursor(uid, epoch, a.Last), PageCount: len(pages), ExpiresAt: p.now().Add(15 * time.Minute).UnixMilli()}
	if _, e = tx.ExecContext(ctx, "INSERT INTO sync_snapshots(user_id,id,epoch,seq,page_count,expires_at) VALUES (?,?,?,?,?,?)", a.User, result.ID, epoch, a.Last, result.PageCount, result.ExpiresAt); e != nil {
		return Snapshot{}, e
	}
	for i, raw := range pages {
		hash := sha256.Sum256(raw)
		if _, e = tx.ExecContext(ctx, "INSERT INTO sync_snapshot_pages(user_id,snapshot_id,page_number,payload,checksum) VALUES (?,?,?,?,?)", a.User, result.ID, i, raw, hex.EncodeToString(hash[:])); e != nil {
			return Snapshot{}, e
		}
	}
	if e = tx.Commit(); e != nil {
		return Snapshot{}, e
	}
	return result, nil
}
func readSnapshotRows(ctx context.Context, tx *sql.Tx, user, kind string, emit func(*Change) error) error {
	if kind == "taskCategory" {
		rows, e := tx.QueryContext(ctx, "SELECT task_id,category_id,present,updated_at,version FROM task_categories WHERE user_id=? ORDER BY task_id,category_id", user)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			c := &Change{EntityType: kind, Operation: "upsert", Fields: map[string]interface{}{}}
			var present bool
			var updated int64
			if e = rows.Scan(&c.ParentID, &c.EntityID, &present, &updated, &c.Version); e != nil {
				return e
			}
			c.Fields["present"] = present
			c.Fields["updated_at"] = updated
			if e = emit(c); e != nil {
				return e
			}
		}
		return rows.Err()
	}
	def := definitions[kind]
	keys := sortedKeys(def.fields)
	columns := append([]string{"id"}, keys...)
	columns = append(columns, "updated_at", "deleted_at", "version")
	order := "id"
	if kind == "subtask" {
		columns = append(columns, "task_id")
		order = "task_id,id"
	}
	rows, e := tx.QueryContext(ctx, "SELECT "+strings.Join(columns, ",")+" FROM "+def.table+" WHERE user_id=? ORDER BY "+order, user)
	if e != nil {
		return e
	}
	defer rows.Close()
	for rows.Next() {
		raw := make([]interface{}, len(columns))
		dest := make([]interface{}, len(columns))
		for i := range raw {
			dest[i] = &raw[i]
		}
		if e = rows.Scan(dest...); e != nil {
			return e
		}
		c := &Change{EntityType: kind, EntityID: text(raw[0]), Operation: "upsert", Fields: map[string]interface{}{}, Version: stringValue(raw[len(keys)+3])}
		if kind == "subtask" {
			c.ParentID = text(raw[len(raw)-1])
		}
		for i, key := range keys {
			v := raw[i+1]
			switch def.fields[key] {
			case textField, decimalField:
				c.Fields[key] = stringValue(v)
			case boolField:
				n, e := integer(v)
				if e != nil {
					return e
				}
				c.Fields[key] = n != 0
			case timeField:
				n, e := integer(v)
				if e != nil {
					return e
				}
				c.Fields[key] = n
			}
		}
		updated, e := integer(raw[len(keys)+1])
		if e != nil {
			return e
		}
		c.Fields["updated_at"] = updated
		deleted := raw[len(keys)+2]
		if deleted != nil {
			n, e := integer(deleted)
			if e != nil {
				return e
			}
			c.Fields["deleted_at"] = n
			c.Operation = "delete"
		}
		if _, e = strconv.ParseUint(c.Version, 10, 64); e != nil {
			return fmt.Errorf("invalid entity version")
		}
		if e = emit(c); e != nil {
			return e
		}
	}
	return rows.Err()
}
func (p *Protocol) SnapshotPage(ctx context.Context, uid, epoch, id string, page int) (SnapshotPage, error) {
	result := SnapshotPage{}
	if parsed, e := uuid.Parse(id); e != nil || parsed.String() != id || page < 0 {
		return result, fail("INVALID_SNAPSHOT")
	}
	tx, e := p.Store.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if e != nil {
		return result, e
	}
	defer tx.Rollback()
	a, e := account(ctx, tx, uid, "")
	if e != nil {
		return result, e
	}
	if e = p.ready(a, epoch); e != nil {
		return result, e
	}
	e = tx.QueryRowContext(ctx, "SELECT p.payload,p.checksum FROM sync_snapshot_pages p JOIN sync_snapshots s ON s.user_id=p.user_id AND s.id=p.snapshot_id WHERE s.user_id=? AND s.epoch=? AND s.id=? AND s.expires_at>? AND p.page_number=?", a.User, epoch, id, p.now().UnixMilli(), page).Scan(&result.Payload, &result.Checksum)
	if e == sql.ErrNoRows {
		return result, fail("SNAPSHOT_EXPIRED")
	}
	return result, e
}
