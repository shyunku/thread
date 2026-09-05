package canonical

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"strings"
	"thread_api/service/syncmigration"
	"time"
)

// BackfillAccount is operator-only. It never overwrites a v2 account.
// Operators must stop every old writer before calling this function.
func (s *Store) BackfillAccount(ctx context.Context, uid string) (bool, error) {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return false, e
	}
	defer tx.Rollback()
	if _, e = tx.ExecContext(ctx, "INSERT INTO sync_users(uid) VALUES (?) ON DUPLICATE KEY UPDATE uid=VALUES(uid)", uid); e != nil {
		return false, e
	}
	a, e := account(ctx, tx, uid, " FOR UPDATE")
	if e != nil {
		return false, e
	}
	if a.Mode == "v2" {
		if a.Epoch == "" {
			return false, fail("INVALID_ACCOUNT_EPOCH")
		}
		return false, nil
	}
	if a.Mode != "legacy" {
		return false, fail("ACCOUNT_STATE_REVIEW_REQUIRED")
	}
	if a.Last != "0" || a.Minimum != "1" || a.Epoch != "" {
		return false, fail("ACCOUNT_STATE_REVIEW_REQUIRED")
	}
	for _, table := range []string{"tasks", "categories", "subtasks", "task_categories", "sync_devices", "sync_change_log", "sync_receipts", "sync_occurrences", "sync_snapshots", "sync_backfills"} {
		var count int
		if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" WHERE user_id=?", a.User).Scan(&count); e != nil {
			return false, e
		}
		if count != 0 {
			return false, fail("NONEMPTY_CANONICAL_ACCOUNT")
		}
	}
	// The outer account lock fences bridge writers; the read-only preflight uses
	// a separate connection and does not use the legacy in-memory chain loader.
	source, e := syncmigration.ReadSource(ctx, s.DB, uid)
	if e != nil {
		return false, fail("LEGACY_SOURCE_INVALID")
	}
	plan, e := syncmigration.BuildPlan(source)
	if e != nil {
		return false, fail("LEGACY_SOURCE_INVALID")
	}
	now := time.Now()
	if s.Now != nil {
		now = s.Now()
	}
	c := &mutationContext{ctx: ctx, tx: tx, user: a.User, uid: uid, now: now}
	for _, group := range []struct {
		kind string
		rows []map[string]interface{}
	}{
		{"category", plan.Rows.Categories}, {"task", plan.Rows.Tasks}, {"subtask", plan.Rows.Subtasks},
	} {
		def := definitions[group.kind]
		for _, raw := range group.rows {
			id, ok := raw["id"].(string)
			if !ok {
				return false, fail("INVALID_IMPORT_ID")
			}
			parent, _ := raw["task_id"].(string)
			fields := map[string]interface{}{}
			for k, v := range def.defaults {
				fields[k] = v
			}
			for k, v := range raw {
				if k == "id" || k == "task_id" {
					continue
				}
				if _, ok := def.fields[k]; !ok {
					return false, fail("UNKNOWN_IMPORT_FIELD")
				}
				fields[k] = v
			}
			names := []string{"user_id", "id"}
			args := []interface{}{a.User, id}
			if group.kind == "subtask" {
				names = append(names, "task_id")
				args = append(args, parent)
			}
			versions := map[string]string{}
			for _, k := range sortedKeys(fields) {
				names = append(names, k)
				args = append(args, fields[k])
				versions[k] = "0"
			}
			versionJSON, _ := json.Marshal(versions)
			names = append(names, "updated_at", "version", "field_versions")
			args = append(args, now.UnixMilli(), 0, versionJSON)
			if _, e = tx.ExecContext(ctx, "INSERT INTO "+def.table+"("+strings.Join(names, ",")+") VALUES ("+strings.TrimSuffix(strings.Repeat("?,", len(args)), ",")+")", args...); e != nil {
				return false, e
			}
			// Compare every persisted field, detecting DB coercion/truncation before
			// publishing the mode/epoch. JSON Number and integer encode identically.
			persisted, e := c.load(group.kind, id, parent)
			if e != nil {
				return false, e
			}
			want, _ := json.Marshal(fields)
			got, _ := json.Marshal(persisted.fields)
			if string(want) != string(got) {
				return false, fail("IMPORT_FIELD_PARITY_FAILED")
			}
		}
	}
	for _, r := range plan.Rows.TaskCategories {
		if _, e = tx.ExecContext(ctx, "INSERT INTO task_categories(user_id,task_id,category_id,present,updated_at,version) VALUES (?,?,?,true,?,0)", a.User, r["task_id"], r["category_id"], now.UnixMilli()); e != nil {
			return false, e
		}
	}
	for _, entry := range []struct {
		table string
		count int
	}{{"tasks", len(plan.Rows.Tasks)}, {"categories", len(plan.Rows.Categories)}, {"subtasks", len(plan.Rows.Subtasks)}, {"task_categories", len(plan.Rows.TaskCategories)}} {
		var n int
		if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+entry.table+" WHERE user_id=?", a.User).Scan(&n); e != nil {
			return false, e
		}
		if n != entry.count {
			return false, fail("IMPORT_COUNT_PARITY_FAILED")
		}
	}
	epoch := uuid.NewString()
	if _, e = tx.ExecContext(ctx, "INSERT INTO sync_backfills VALUES (?,?,?,?,?)", a.User, plan.SourceChecksum, plan.RowsChecksum, epoch, now.UnixMilli()); e != nil {
		return false, e
	}
	if _, e = tx.ExecContext(ctx, "UPDATE sync_users SET mode='v2',epoch=?,last_seq=0,min_available_seq=1 WHERE id=?", epoch, a.User); e != nil {
		return false, e
	}
	if e = tx.Commit(); e != nil {
		return false, fmt.Errorf("IMPORT_COMMIT_UNKNOWN_RETRY")
	}
	return true, nil
}

// New accounts need no legacy backfill; existing history is never auto-imported.
func (p *Protocol) provisionEmpty(ctx context.Context, uid string) (Account, error) {
	tx, e := p.Store.DB.BeginTx(ctx, nil)
	if e != nil {
		return Account{}, e
	}
	defer tx.Rollback()
	var exists int
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM user_master WHERE uid=?", uid).Scan(&exists); e != nil {
		return Account{}, e
	}
	if exists != 1 {
		return Account{}, fail("ACCOUNT_NOT_FOUND")
	}
	if _, e = tx.ExecContext(ctx, "INSERT INTO sync_users(uid) VALUES (?) ON DUPLICATE KEY UPDATE uid=VALUES(uid)", uid); e != nil {
		return Account{}, e
	}
	a, e := account(ctx, tx, uid, " FOR UPDATE")
	if e != nil {
		return a, e
	}
	if a.Mode == "v2" {
		return a, nil
	}
	if a.Mode != "legacy" {
		return a, fail("ACCOUNT_MIGRATION_REQUIRED")
	}
	if a.Last != "0" || a.Minimum != "1" || a.Epoch != "" {
		return a, fail("ACCOUNT_MIGRATION_REQUIRED")
	}
	var history int
	if e = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM blocks WHERE uid=?) OR EXISTS(SELECT 1 FROM transactions WHERE `from`=?)", uid, uid).Scan(&history); e != nil {
		return a, e
	}
	if history != 0 {
		return a, fail("ACCOUNT_MIGRATION_REQUIRED")
	}
	for _, table := range []string{"tasks", "subtasks", "categories", "task_categories", "sync_devices", "sync_change_log", "sync_receipts", "sync_occurrences", "sync_snapshots", "sync_backfills"} {
		var n int
		if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" WHERE user_id=?", a.User).Scan(&n); e != nil {
			return a, e
		}
		if n != 0 {
			return a, fail("ACCOUNT_MIGRATION_REQUIRED")
		}
	}
	a.Mode = "v2"
	a.Epoch = uuid.NewString()
	if _, e = tx.ExecContext(ctx, "UPDATE sync_users SET mode='v2',epoch=? WHERE id=?", a.Epoch, a.User); e != nil {
		return a, e
	}
	if e = tx.Commit(); e != nil {
		return a, e
	}
	return a, nil
}
