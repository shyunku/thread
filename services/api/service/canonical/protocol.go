package canonical

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"strconv"
	"strings"
	"time"
)

// Protocol is deliberately independent of v1 chains. Disabled accounts never
// fall back from v2 to legacy when the global switch is turned off.
type Protocol struct {
	Store        *Store
	Key          []byte
	Enabled      bool
	PruneEnabled bool
}
type Account struct {
	User    string `json:"-"`
	Mode    string `json:"mode"`
	Epoch   string `json:"epoch"`
	Last    string `json:"highWatermark"`
	Minimum string `json:"minAvailableSeq"`
}
type queryRow interface {
	QueryRowContext(context.Context, string, ...interface{}) *sql.Row
}

func account(ctx context.Context, q queryRow, uid, suffix string) (Account, error) {
	a := Account{Mode: "legacy", Last: "0", Minimum: "1"}
	var epoch sql.NullString
	err := q.QueryRowContext(ctx, "SELECT id,mode,epoch,last_seq,min_available_seq FROM sync_users WHERE uid=?"+suffix, uid).Scan(&a.User, &a.Mode, &epoch, &a.Last, &a.Minimum)
	if err == sql.ErrNoRows {
		return a, nil
	}
	a.Epoch = epoch.String
	return a, err
}
func (p *Protocol) Account(ctx context.Context, uid string) (Account, error) {
	return account(ctx, p.Store.DB, uid, "")
}
func (p *Protocol) ready(a Account, epoch string) error {
	if a.Mode != "v2" {
		return fail("ACCOUNT_NOT_READY")
	}
	if !p.Enabled {
		return fail("SYNC_DISABLED")
	}
	if a.Epoch == "" || a.Epoch != epoch {
		return fail("RESET_REQUIRED")
	}
	return nil
}
func (p *Protocol) now() time.Time {
	if p.Store.Now != nil {
		return p.Store.Now()
	}
	return time.Now()
}
func ErrorCode(err error) string {
	var f fault
	if errors.As(err, &f) {
		return string(f)
	}
	return "SYNC_UNAVAILABLE"
}
func number(v string) (uint64, error) {
	n, e := strconv.ParseUint(v, 10, 64)
	if e != nil || strconv.FormatUint(n, 10) != v {
		return 0, fail("INVALID_CURSOR")
	}
	return n, nil
}

type cursor struct{ UID, Epoch, Seq string }

func (p *Protocol) Cursor(uid, epoch, seq string) string {
	raw, _ := json.Marshal(cursor{uid, epoch, seq})
	body := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, p.Key)
	mac.Write([]byte(body))
	return body + "." + hex.EncodeToString(mac.Sum(nil))
}
func (p *Protocol) parseCursor(token, uid, epoch string) (uint64, error) {
	if len(p.Key) < 32 || len(token) > 4096 {
		return 0, fail("INVALID_CURSOR")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return 0, fail("INVALID_CURSOR")
	}
	sig, e := hex.DecodeString(parts[1])
	if e != nil {
		return 0, fail("INVALID_CURSOR")
	}
	mac := hmac.New(sha256.New, p.Key)
	mac.Write([]byte(parts[0]))
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return 0, fail("INVALID_CURSOR")
	}
	raw, e := base64.RawURLEncoding.DecodeString(parts[0])
	if e != nil {
		return 0, fail("INVALID_CURSOR")
	}
	var c cursor
	if json.Unmarshal(raw, &c) != nil {
		return 0, fail("INVALID_CURSOR")
	}
	if c.UID != uid {
		return 0, fail("CURSOR_FORBIDDEN")
	}
	if c.Epoch != epoch {
		return 0, fail("RESET_REQUIRED")
	}
	return number(c.Seq)
}
func (p *Protocol) RegisterDevice(ctx context.Context, uid, epoch, id string) error {
	parsed, e := uuid.Parse(id)
	if e != nil || parsed.String() != id {
		return fail("INVALID_REQUEST_ID")
	}
	tx, e := p.Store.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	a, e := account(ctx, tx, uid, " FOR UPDATE")
	if e != nil {
		return e
	}
	if e = p.ready(a, epoch); e != nil {
		return e
	}
	var revoked sql.NullInt64
	e = tx.QueryRowContext(ctx, "SELECT revoked_at FROM sync_devices WHERE user_id=? AND device_id=?", a.User, id).Scan(&revoked)
	if e == nil && revoked.Valid {
		return fail("DEVICE_REVOKED")
	}
	if e != nil && e != sql.ErrNoRows {
		return e
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO sync_devices(user_id,device_id,last_seen_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE last_seen_at=VALUES(last_seen_at)", a.User, id, p.now().UnixMilli())
	if e != nil {
		return e
	}
	return tx.Commit()
}

type LogEntry struct {
	Seq            string          `json:"seq"`
	DeviceID       string          `json:"deviceId"`
	ClientChangeID string          `json:"clientChangeId"`
	Payload        json.RawMessage `json:"payload"`
}
type Page struct {
	Epoch         string     `json:"epoch"`
	Entries       []LogEntry `json:"entries"`
	NextCursor    string     `json:"nextCursor"`
	Until         string     `json:"until"`
	HighWatermark string     `json:"highWatermark"`
	HasMore       bool       `json:"hasMore"`
}

func (p *Protocol) Pull(ctx context.Context, uid, epoch, after, until string, limit int) (Page, error) {
	result := Page{Epoch: epoch, Entries: []LogEntry{}}
	if limit < 1 || limit > 500 {
		return result, fail("INVALID_LIMIT")
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
	n, e := p.parseCursor(after, uid, epoch)
	if e != nil {
		return result, e
	}
	last, e := number(a.Last)
	if e != nil {
		return result, e
	}
	minimum, e := number(a.Minimum)
	if e != nil || minimum < 1 {
		return result, fail("LOG_GAP")
	}
	if n < minimum-1 {
		return result, fail("RESET_REQUIRED")
	}
	high := last
	if until != "" {
		high, e = p.parseCursor(until, uid, epoch)
		if e != nil {
			return result, e
		}
	}
	if n > high || high > last {
		return result, fail("INVALID_CURSOR")
	}
	result.HighWatermark = strconv.FormatUint(high, 10)
	result.Until = p.Cursor(uid, epoch, result.HighWatermark)
	rows, e := tx.QueryContext(ctx, "SELECT seq,device_id,client_change_id,payload FROM sync_change_log WHERE user_id=? AND epoch=? AND seq>? AND seq<=? ORDER BY seq LIMIT ?", a.User, epoch, n, high, limit)
	if e != nil {
		return result, e
	}
	defer rows.Close()
	size := 0
	for rows.Next() {
		var entry LogEntry
		if e = rows.Scan(&entry.Seq, &entry.DeviceID, &entry.ClientChangeID, &entry.Payload); e != nil {
			return result, e
		}
		seq, e := number(entry.Seq)
		if e != nil || seq != n+1 {
			return result, fail("LOG_GAP")
		}
		// Never split a logical mutation. One envelope may be up to 16 MiB.
		if size+len(entry.Payload) > 20*1024*1024 && len(result.Entries) > 0 {
			break
		}
		size += len(entry.Payload)
		result.Entries = append(result.Entries, entry)
		n = seq
	}
	if e = rows.Err(); e != nil {
		return result, e
	}
	if len(result.Entries) == 0 && n < high {
		return result, fail("LOG_GAP")
	}
	result.NextCursor = p.Cursor(uid, epoch, strconv.FormatUint(n, 10))
	result.HasMore = n < high
	return result, nil
}

// Prune is an explicitly invoked maintenance operation, disabled by default.
// Receipts, occurrence records and tombstones are never deleted here.
func (p *Protocol) Prune(ctx context.Context, uid string, through uint64) (uint64, error) {
	if !p.PruneEnabled {
		return 0, fail("PRUNE_DISABLED")
	}
	tx, e := p.Store.DB.BeginTx(ctx, nil)
	if e != nil {
		return 0, e
	}
	defer tx.Rollback()
	a, e := account(ctx, tx, uid, " FOR UPDATE")
	if e != nil {
		return 0, e
	}
	if e = p.ready(a, a.Epoch); e != nil {
		return 0, e
	}
	last, e := number(a.Last)
	if e != nil {
		return 0, e
	}
	if through > last {
		return 0, fail("INVALID_CURSOR")
	}
	var pin sql.NullString
	if e = tx.QueryRowContext(ctx, "SELECT MIN(seq) FROM sync_snapshots WHERE user_id=? AND epoch=? AND expires_at>?", a.User, a.Epoch, p.now().UnixMilli()).Scan(&pin); e != nil {
		return 0, e
	}
	if pin.Valid {
		n, e := number(pin.String)
		if e != nil {
			return 0, e
		}
		if through > n {
			through = n
		}
	}
	min, e := number(a.Minimum)
	if e != nil {
		return 0, e
	}
	if through < min {
		return min - 1, nil
	}
	if through == ^uint64(0) {
		return 0, fail("SEQUENCE_EXHAUSTED")
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM sync_change_log WHERE user_id=? AND seq<=?", a.User, through); e != nil {
		return 0, e
	}
	if _, e = tx.ExecContext(ctx, "UPDATE sync_users SET min_available_seq=? WHERE id=?", through+1, a.User); e != nil {
		return 0, e
	}
	if e = tx.Commit(); e != nil {
		return 0, e
	}
	return through, nil
}
