// Package canonical implements transactional v2 mutations and sync storage.
package canonical

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"math"
	"sort"
	"strconv"
	"time"
)

type Mutation struct {
	CategoryIDs    []string               `json:"categoryIds,omitempty"`
	Epoch          string                 `json:"epoch"`
	DeviceID       string                 `json:"deviceId"`
	ClientChangeID string                 `json:"clientChangeId"`
	EntityType     string                 `json:"entityType"`
	EntityID       string                 `json:"entityId"`
	ParentID       string                 `json:"parentId,omitempty"`
	Operation      string                 `json:"operation"`
	BaseVersion    string                 `json:"baseVersion"`
	Changes        map[string]interface{} `json:"changes,omitempty"`
	AnchorID       string                 `json:"anchorId,omitempty"`
	After          bool                   `json:"after,omitempty"`
	Generation     string                 `json:"generation,omitempty"`
}
type Result struct {
	Status         string            `json:"status"`
	Code           string            `json:"code,omitempty"`
	Seq            string            `json:"seq"`
	ConflictFields []string          `json:"conflictFields,omitempty"`
	Generated      map[string]string `json:"generated,omitempty"`
	Duplicate      bool              `json:"duplicate,omitempty"`
}
type Change struct {
	EntityType string                 `json:"entityType"`
	EntityID   string                 `json:"entityId"`
	ParentID   string                 `json:"parentId,omitempty"`
	Operation  string                 `json:"operation"`
	Version    string                 `json:"version"`
	Fields     map[string]interface{} `json:"fields"`
}
type Store struct {
	DB  *sql.DB
	Now func() time.Time
}
type fault string

func (f fault) Error() string { return string(f) }
func fail(code string) error  { return fault(code) }

type mutationContext struct {
	ctx                  context.Context
	tx                   *sql.Tx
	user                 string
	uid                  string
	seq                  uint64
	now                  time.Time
	changes              []*Change
	changeIndex          map[string]*Change
	conflicts            map[string]bool
	generated            map[string]string
	reused               *Result
	occurrenceTask       string
	occurrenceGeneration string
}

func (c *mutationContext) record(kind, id, parent, op string, fields map[string]interface{}) {
	encoded, _ := json.Marshal([]string{kind, parent, id})
	key := string(encoded)
	prior := c.changeIndex[key]
	if prior == nil {
		prior = &Change{EntityType: kind, EntityID: id, ParentID: parent, Operation: op, Version: strconv.FormatUint(c.seq, 10), Fields: map[string]interface{}{}}
		c.changes = append(c.changes, prior)
		c.changeIndex[key] = prior
	}
	if op == "delete" {
		prior.Operation = op
	}
	for k, v := range fields {
		prior.Fields[k] = v
	}
	prior.Fields["updated_at"] = c.now.UnixMilli()
}

// Apply requires a UID from authenticated server context, never a client body.
func (s *Store) Apply(ctx context.Context, uid string, m Mutation) (Result, error) {
	if !validID(uid) {
		return Result{}, fail("INVALID_USER")
	}
	for _, v := range []string{m.Epoch, m.DeviceID, m.ClientChangeID} {
		if parsed, e := uuid.Parse(v); e != nil || parsed.String() != v {
			return Result{}, fail("INVALID_REQUEST_ID")
		}
	}
	encoded, e := json.Marshal(m)
	if e != nil || len(encoded) > 1024*1024 {
		return Result{}, fail("INVALID_MUTATION_SIZE")
	}
	sum := sha256.Sum256(encoded)
	requestHash := hex.EncodeToString(sum[:])
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return Result{}, fmt.Errorf("sync transaction unavailable")
	}
	defer tx.Rollback()
	var internal, mode string
	var epoch sql.NullString
	var last uint64
	if e = tx.QueryRowContext(ctx, "SELECT id,mode,epoch,last_seq FROM sync_users WHERE uid=? FOR UPDATE", uid).Scan(&internal, &mode, &epoch, &last); e != nil {
		if e == sql.ErrNoRows {
			return Result{}, fail("ACCOUNT_NOT_READY")
		}
		return Result{}, fmt.Errorf("sync account unavailable")
	}
	if mode != "v2" {
		return Result{}, fail("UPDATE_REQUIRED")
	}
	if !epoch.Valid || epoch.String != m.Epoch {
		return Result{}, fail("RESET_REQUIRED")
	}
	var active int
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM sync_devices WHERE user_id=? AND device_id=? AND revoked_at IS NULL", internal, m.DeviceID).Scan(&active); e != nil {
		return Result{}, fmt.Errorf("sync device unavailable")
	}
	if active != 1 {
		return Result{}, fail("DEVICE_NOT_REGISTERED")
	}
	var oldHash string
	var oldResult []byte
	e = tx.QueryRowContext(ctx, "SELECT request_hash,result FROM sync_receipts WHERE user_id=? AND device_id=? AND client_change_id=?", internal, m.DeviceID, m.ClientChangeID).Scan(&oldHash, &oldResult)
	if e == nil {
		if oldHash != requestHash {
			return Result{}, fail("IDEMPOTENCY_KEY_REUSED")
		}
		var result Result
		if json.Unmarshal(oldResult, &result) != nil {
			return Result{}, fmt.Errorf("invalid receipt")
		}
		result.Duplicate = true
		return result, nil
	}
	if e != sql.ErrNoRows {
		return Result{}, fmt.Errorf("receipt lookup failed")
	}
	if last == math.MaxUint64 {
		return Result{}, fail("SEQUENCE_EXHAUSTED")
	}
	now := time.Now()
	if s.Now != nil {
		now = s.Now()
	}
	c := &mutationContext{ctx: ctx, tx: tx, user: internal, uid: uid, seq: last + 1, now: now, changeIndex: map[string]*Change{}, conflicts: map[string]bool{}, generated: map[string]string{}}
	if _, e = tx.ExecContext(ctx, "SAVEPOINT mutation"); e != nil {
		return Result{}, fmt.Errorf("mutation savepoint failed")
	}
	result := Result{Status: "accepted", Seq: strconv.FormatUint(last, 10)}
	e = c.execute(m)
	if e != nil {
		var domain fault
		if !errors.As(e, &domain) {
			return Result{}, fmt.Errorf("sync mutation persistence failed")
		}
		if _, e = tx.ExecContext(ctx, "ROLLBACK TO SAVEPOINT mutation"); e != nil {
			return Result{}, fmt.Errorf("mutation rollback failed")
		}
		result.Status = "rejected"
		result.Code = string(domain)
	} else if c.reused != nil {
		result = *c.reused
		result.Code = "OCCURRENCE_ALREADY_COMPLETED"
	} else if len(c.changes) > 0 {
		result.Seq = strconv.FormatUint(c.seq, 10)
		for field := range c.conflicts {
			result.ConflictFields = append(result.ConflictFields, field)
		}
		sort.Strings(result.ConflictFields)
		result.Generated = c.generated
		payload, e := json.Marshal(struct {
			Changes []*Change `json:"changes"`
		}{c.changes})
		if e != nil || len(payload) > 16*1024*1024 {
			return Result{}, fmt.Errorf("mutation change envelope exceeds safe limit")
		}
		_, e = tx.ExecContext(ctx, "INSERT INTO sync_change_log(user_id,seq,epoch,device_id,client_change_id,payload,created_at) VALUES (?,?,?,?,?,?,?)",
			internal, result.Seq, m.Epoch, m.DeviceID, m.ClientChangeID, payload, now.UnixMilli())
		if e != nil {
			return Result{}, fmt.Errorf("change log append failed")
		}
		if _, e = tx.ExecContext(ctx, "UPDATE sync_users SET last_seq=? WHERE id=?", result.Seq, internal); e != nil {
			return Result{}, fmt.Errorf("sequence update failed")
		}
	}
	receipt, e := json.Marshal(result)
	if e != nil {
		return Result{}, fmt.Errorf("receipt encode failed")
	}
	if c.occurrenceTask != "" && result.Status == "accepted" {
		if _, e = tx.ExecContext(ctx, "INSERT INTO sync_occurrences(user_id,task_id,generation,result) VALUES (?,?,?,?)", internal, c.occurrenceTask, c.occurrenceGeneration, receipt); e != nil {
			return Result{}, fmt.Errorf("occurrence receipt failed")
		}
	}
	if _, e = tx.ExecContext(ctx, "INSERT INTO sync_receipts(user_id,device_id,client_change_id,request_hash,result,created_at) VALUES (?,?,?,?,?,?)", internal, m.DeviceID, m.ClientChangeID, requestHash, receipt, now.UnixMilli()); e != nil {
		return Result{}, fmt.Errorf("receipt insert failed")
	}
	if e = tx.Commit(); e != nil {
		return Result{}, fmt.Errorf("sync commit outcome unknown; retry the same mutation ID")
	}
	return result, nil
}
