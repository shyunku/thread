package canonical

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"thread_api/service/database/migrations"
	"time"
)

func TestMySQLMutationEngine(t *testing.T) {
	dsn := os.Getenv("THREAD_CANONICAL_TEST_DSN")
	if dsn == "" {
		t.Skip("explicit empty thread_canonical_test_* DB required")
	}
	cfg, e := mysql.ParseDSN(dsn)
	if e != nil || !strings.HasPrefix(cfg.DBName, "thread_canonical_test_") {
		t.Fatal("unsafe test DB")
	}
	db, e := sql.Open("mysql", dsn)
	if e != nil {
		t.Fatal("test connection failed")
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	db.SetMaxOpenConns(16)
	var count int
	if e = db.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()").Scan(&count); e != nil || count != 0 {
		t.Fatal("test DB must be empty")
	}
	mustExec := func(query string, args ...interface{}) {
		t.Helper()
		if _, e := db.ExecContext(ctx, query, args...); e != nil {
			t.Fatal(e)
		}
	}
	mustExec("CREATE TABLE user_master(uid VARCHAR(255) PRIMARY KEY) ENGINE=InnoDB")
	mustExec("CREATE TABLE transactions(txid INT,version INT,type BIGINT,`from` VARCHAR(255),timestamp BIGINT,content BLOB,hash VARCHAR(255)) ENGINE=InnoDB")
	mustExec("CREATE TABLE blocks(uid VARCHAR(255),block_number BIGINT,state LONGBLOB,transitions LONGBLOB,tx_hash VARCHAR(255),block_hash VARCHAR(255),prev_block_hash VARCHAR(255)) ENGINE=InnoDB")
	if _, e = migrations.Run(ctx, db, migrations.Server); e != nil {
		t.Fatal(e)
	}
	now := time.Date(2026, 9, 5, 12, 0, 0, 0, time.UTC)
	store := Store{DB: db, Now: func() time.Time { return now }}
	uid := "fixture-main"
	epoch := uuid.NewString()
	device := uuid.NewString()
	device2 := uuid.NewString()
	mustExec("INSERT INTO user_master VALUES (?)", uid)
	mustExec("INSERT INTO sync_users(uid,mode,epoch) VALUES (?,'v2',?)", uid, epoch)
	var internal string
	if e = db.QueryRowContext(ctx, "SELECT id FROM sync_users WHERE uid=?", uid).Scan(&internal); e != nil {
		t.Fatal(e)
	}
	for _, d := range []string{device, device2} {
		mustExec("INSERT INTO sync_devices(user_id,device_id,last_seen_at) VALUES (?,?,?)", internal, d, now.UnixMilli())
	}
	makeMutation := func(kind, id, op string, fields map[string]interface{}) Mutation {
		return Mutation{Epoch: epoch, DeviceID: device, ClientChangeID: uuid.NewString(), EntityType: kind, EntityID: id, Operation: op, BaseVersion: "0", Changes: fields}
	}
	apply := func(m Mutation) Result {
		t.Helper()
		r, e := store.Apply(ctx, uid, m)
		if e != nil {
			t.Fatal(e)
		}
		return r
	}
	accepted := func(m Mutation) Result {
		t.Helper()
		r := apply(m)
		if r.Status != "accepted" {
			t.Fatalf("rejected: %+v", r)
		}
		return r
	}
	queryInt := func(query string, args ...interface{}) uint64 {
		t.Helper()
		var n uint64
		if e := db.QueryRowContext(ctx, query, args...).Scan(&n); e != nil {
			t.Fatal(e)
		}
		return n
	}
	task := makeMutation("task", "shared", "create", map[string]interface{}{"title": "original", "memo": "keep"})
	first := accepted(task)
	if first.Seq != "1" {
		t.Fatal(first)
	}
	duplicate := accepted(task)
	if !duplicate.Duplicate || duplicate.Seq != first.Seq {
		t.Fatal("retry not deduplicated")
	}
	different := task
	different.Changes = map[string]interface{}{"title": "different"}
	if _, e = store.Apply(ctx, uid, different); e != fault("IDEMPOTENCY_KEY_REUSED") {
		t.Fatal("idempotency reuse allowed", e)
	}
	patch := makeMutation("task", "shared", "patch", map[string]interface{}{"title": "from-a"})
	patch.BaseVersion = first.Seq
	accepted(patch)
	if n := queryInt("SELECT JSON_CONTAINS_PATH(payload,'one','$.changes[0].fields.memo') FROM sync_change_log WHERE user_id=? AND seq=2", internal); n != 0 {
		t.Fatal("title-only patch logged unchanged memo")
	}
	done := makeMutation("task", "shared", "patch", map[string]interface{}{"done": true})
	done.DeviceID = device2
	done.BaseVersion = first.Seq
	merged := accepted(done)
	if len(merged.ConflictFields) != 0 {
		t.Fatal("independent fields incorrectly conflicted", merged)
	}
	var title, memo string
	var isDone bool
	if e = db.QueryRowContext(ctx, "SELECT title,memo,done FROM tasks WHERE user_id=? AND id='shared'", internal).Scan(&title, &memo, &isDone); e != nil || title != "from-a" || memo != "keep" || !isDone {
		t.Fatal("field merge lost data", e)
	}
	overwrite := makeMutation("task", "shared", "patch", map[string]interface{}{"title": "last-server-write"})
	overwrite.BaseVersion = first.Seq
	resolved := accepted(overwrite)
	if len(resolved.ConflictFields) != 1 || resolved.ConflictFields[0] != "title" {
		t.Fatal("same-field conflict not reported", resolved)
	}

	// Failure after the canonical UPDATE must roll back state, sequence, log and receipt.
	before := queryInt("SELECT last_seq FROM sync_users WHERE id=?", internal)
	mustExec("ALTER TABLE sync_change_log ADD CONSTRAINT reject_future_seq CHECK (seq<=" + strconv.FormatUint(before, 10) + ")")
	failed := makeMutation("task", "shared", "patch", map[string]interface{}{"title": "must-rollback"})
	if _, e = store.Apply(ctx, uid, failed); e == nil {
		t.Fatal("injected log failure accepted")
	}
	mustExec("ALTER TABLE sync_change_log DROP CHECK reject_future_seq")
	if n := queryInt("SELECT last_seq FROM sync_users WHERE id=?", internal); n != before {
		t.Fatal("sequence escaped rollback")
	}
	if n := queryInt("SELECT COUNT(*) FROM sync_receipts WHERE user_id=? AND client_change_id=?", internal, failed.ClientChangeID); n != 0 {
		t.Fatal("failure receipt persisted")
	}
	if e = db.QueryRowContext(ctx, "SELECT title FROM tasks WHERE user_id=? AND id='shared'", internal).Scan(&title); e != nil || title != "last-server-write" {
		t.Fatal("row escaped rollback")
	}
	accepted(failed)

	// Domain failure is remembered, without consuming a change sequence.
	bad := makeMutation("task", "shared", "patch", map[string]interface{}{"not_a_column": "bad"})
	rejected := apply(bad)
	if rejected.Status != "rejected" || rejected.Code != "INVALID_FIELD" {
		t.Fatal(rejected)
	}
	retried := apply(bad)
	if !retried.Duplicate || retried.Code != rejected.Code {
		t.Fatal("domain rejection not idempotent")
	}
	future := makeMutation("task", "shared", "patch", map[string]interface{}{"title": "future"})
	future.BaseVersion = "999999"
	if r := apply(future); r.Code != "INVALID_BASE_VERSION" {
		t.Fatal(r)
	}

	// Per-user DB locks serialize separate connections and assign gap-free committed seq.
	start := queryInt("SELECT last_seq FROM sync_users WHERE id=?", internal)
	seqs := make(chan uint64, 8)
	errs := make(chan error, 8)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		m := makeMutation("task", "shared", "patch", map[string]interface{}{"memo": "concurrent"})
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, e := store.Apply(ctx, uid, m)
			if e != nil {
				errs <- e
				return
			}
			if r.Status != "accepted" {
				errs <- fault(r.Code)
				return
			}
			n, _ := strconv.ParseUint(r.Seq, 10, 64)
			seqs <- n
		}()
	}
	wg.Wait()
	close(errs)
	close(seqs)
	for e := range errs {
		t.Fatal(e)
	}
	numbers := []uint64{}
	for n := range seqs {
		numbers = append(numbers, n)
	}
	sort.Slice(numbers, func(i, j int) bool { return numbers[i] < numbers[j] })
	if len(numbers) != 8 {
		t.Fatal("missing result")
	}
	for i, n := range numbers {
		if n != start+uint64(i)+1 {
			t.Fatal("sequence gap", numbers)
		}
	}

	// Identical IDs in other accounts are separate rows and foreign-key scopes.
	uid2 := "fixture-other"
	epoch2 := uuid.NewString()
	mustExec("INSERT INTO user_master VALUES (?)", uid2)
	mustExec("INSERT INTO sync_users(uid,mode,epoch) VALUES (?,'v2',?)", uid2, epoch2)
	var internal2 string
	_ = db.QueryRowContext(ctx, "SELECT id FROM sync_users WHERE uid=?", uid2).Scan(&internal2)
	mustExec("INSERT INTO sync_devices(user_id,device_id,last_seen_at) VALUES (?,?,?)", internal2, device, now.UnixMilli())
	other := makeMutation("task", "shared", "create", map[string]interface{}{"title": "other-user"})
	other.Epoch = epoch2
	if r, e := store.Apply(ctx, uid2, other); e != nil || r.Status != "accepted" {
		t.Fatal("tenant-scoped create", r, e)
	}
	stolen := other
	stolen.Epoch = epoch
	if _, e = store.Apply(ctx, uid2, stolen); e != fault("RESET_REQUIRED") {
		t.Fatal("wrong epoch accepted")
	}
	mustExec("UPDATE sync_devices SET revoked_at=? WHERE user_id=? AND device_id=?", now.UnixMilli(), internal2, device)
	if _, e = store.Apply(ctx, uid2, other); e != fault("DEVICE_NOT_REGISTERED") {
		t.Fatal("revoked device accepted")
	}

	// Child + relationship tombstones are committed in the parent deletion envelope.
	accepted(makeMutation("category", "cat", "create", map[string]interface{}{"title": "category", "secret": true, "locked": true}))
	sub := makeMutation("subtask", "child", "create", map[string]interface{}{"title": "child"})
	sub.ParentID = "shared"
	accepted(sub)
	link := makeMutation("taskCategory", "cat", "add", nil)
	link.ParentID = "shared"
	accepted(link)
	if r := apply(makeMutation("category", "cat", "delete", nil)); r.Code != "CATEGORY_IN_USE" {
		t.Fatal("used category deleted", r)
	}
	deletion := accepted(makeMutation("task", "shared", "delete", nil))
	if n := queryInt("SELECT COUNT(*) FROM subtasks WHERE user_id=? AND task_id='shared' AND deleted_at IS NOT NULL", internal); n != 1 {
		t.Fatal("child delete not propagated")
	}
	if n := queryInt("SELECT COUNT(*) FROM task_categories WHERE user_id=? AND task_id='shared' AND present=false", internal); n != 1 {
		t.Fatal("relation delete not propagated")
	}
	var envelope []byte
	if e = db.QueryRowContext(ctx, "SELECT payload FROM sync_change_log WHERE user_id=? AND seq=?", internal, deletion.Seq).Scan(&envelope); e != nil {
		t.Fatal(e)
	}
	var changes struct{ Changes []Change }
	if e = json.Unmarshal(envelope, &changes); e != nil || len(changes.Changes) != 3 {
		t.Fatal("delete not one envelope", e)
	}
	if r := apply(makeMutation("task", "shared", "patch", map[string]interface{}{"title": "resurrect"})); r.Code != "ENTITY_DELETED" {
		t.Fatal("deleted task resurrected", r)
	}
	if r := apply(makeMutation("task", "shared", "create", nil)); r.Code != "ENTITY_ID_REUSED" {
		t.Fatal("deleted ID reused", r)
	}
	accepted(makeMutation("category", "cat", "delete", nil))

	// Ordering uses ranks, not mutable linked-list pointers.
	for _, id := range []string{"a", "b", "c"} {
		accepted(makeMutation("task", id, "create", map[string]interface{}{"title": id}))
	}
	move := makeMutation("task", "c", "move", nil)
	move.AnchorID = "a"
	move.After = false
	accepted(move)
	getOrder := func() string {
		rows, e := db.QueryContext(ctx, "SELECT id FROM tasks WHERE user_id=? AND deleted_at IS NULL ORDER BY sort_rank,id", internal)
		if e != nil {
			t.Fatal(e)
		}
		defer rows.Close()
		ids := []string{}
		for rows.Next() {
			var id string
			_ = rows.Scan(&id)
			ids = append(ids, id)
		}
		return strings.Join(ids, ",")
	}
	if order := getOrder(); order != "c,a,b" {
		t.Fatal("wrong order", order)
	}
	// Force exhausted rank gap in this fixture and verify atomic rebalance.
	mustExec("UPDATE tasks SET sort_rank=CASE id WHEN 'c' THEN 0 WHEN 'a' THEN 1 ELSE 2 END WHERE user_id=? AND deleted_at IS NULL", internal)
	move = makeMutation("task", "b", "move", nil)
	move.AnchorID = "c"
	move.After = true
	accepted(move)
	if order := getOrder(); order != "c,b,a" {
		t.Fatal("rebalance order wrong", order)
	}
	missing := makeMutation("task", "a", "move", nil)
	missing.AnchorID = "missing"
	if r := apply(missing); r.Code != "ANCHOR_DELETED_OR_MISSING" {
		t.Fatal(r)
	}

	// Repeated task completion creates one instance even from two devices.
	day := int64(24 * time.Hour / time.Millisecond)
	repeating := makeMutation("task", "repeat", "create", map[string]interface{}{"title": "repeat", "due_date": now.UnixMilli() - day, "repeat_start_at": now.UnixMilli() - day, "repeat_period": "day"})
	accepted(repeating)
	child := makeMutation("subtask", "repeat-child", "create", map[string]interface{}{"title": "repeat child", "due_date": now.UnixMilli() - day, "done": true})
	child.ParentID = "repeat"
	accepted(child)
	complete := makeMutation("task", "repeat", "completeRecurringTask", nil)
	complete.Generation = "0"
	completed := accepted(complete)
	if completed.Generated["task"] == "" || completed.Generated["subtask:repeat-child"] == "" {
		t.Fatal("generated IDs missing")
	}
	second := complete
	second.ClientChangeID = uuid.NewString()
	second.DeviceID = device2
	same := accepted(second)
	if same.Seq != completed.Seq || same.Generated["task"] != completed.Generated["task"] || same.Code != "OCCURRENCE_ALREADY_COMPLETED" {
		t.Fatal("recurrence duplicated", same)
	}
	if n := queryInt("SELECT COUNT(*) FROM sync_occurrences WHERE user_id=? AND task_id='repeat'", internal); n != 1 {
		t.Fatal("extra occurrence")
	}
	var due, doneAt int64
	var generation string
	if e = db.QueryRowContext(ctx, "SELECT due_date,done,done_at,recurrence_generation FROM tasks WHERE user_id=? AND id='repeat'", internal).Scan(&due, &isDone, &doneAt, &generation); e != nil || due <= now.UnixMilli()-day || isDone || doneAt != 0 || generation != "1" {
		t.Fatal("next occurrence invalid", e)
	}
	if n := queryInt("SELECT COUNT(*) FROM subtasks WHERE user_id=? AND task_id=? AND done=true", internal, completed.Generated["task"]); n != 1 {
		t.Fatal("completed child lost")
	}
	if n := queryInt("SELECT COUNT(*) FROM subtasks WHERE user_id=? AND task_id='repeat' AND done=false AND done_at=0", internal); n != 1 {
		t.Fatal("child not reset")
	}
	// A late invalid category must roll back an already-created task and relation,
	// while retaining the rejected request receipt.
	accepted(makeMutation("category", "atomic-cat", "create", nil))
	compound := makeMutation("task", "compound", "create", map[string]interface{}{"title": "compound"})
	compound.CategoryIDs = []string{"atomic-cat", "missing-category"}
	if r := apply(compound); r.Code != "ENTITY_NOT_FOUND" {
		t.Fatal("compound failure not reported", r)
	}
	if n := queryInt("SELECT COUNT(*) FROM tasks WHERE user_id=? AND id='compound'", internal); n != 0 {
		t.Fatal("partial compound task escaped savepoint")
	}
	if n := queryInt("SELECT COUNT(*) FROM task_categories WHERE user_id=? AND task_id='compound'", internal); n != 0 {
		t.Fatal("partial compound link escaped savepoint")
	}
	compound.ClientChangeID = uuid.NewString()
	compound.CategoryIDs = []string{"atomic-cat"}
	compound.AnchorID = "c"
	compound.After = true
	accepted(compound)
	if n := queryInt("SELECT COUNT(*) FROM task_categories WHERE user_id=? AND task_id='compound' AND present=true", internal); n != 1 {
		t.Fatal("compound create missing link")
	}
	// UTF-8 entity identities are case-sensitive and do not trim trailing spaces.
	for _, id := range []string{"identity", "IDENTITY", "identity "} {
		accepted(makeMutation("task", id, "create", nil))
	}
	// Concurrent retries of one request consume exactly one sequence.
	retry := makeMutation("task", "a", "patch", map[string]interface{}{"memo": "one logical change"})
	start = queryInt("SELECT last_seq FROM sync_users WHERE id=?", internal)
	concurrentResults := make(chan Result, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, e := store.Apply(ctx, uid, retry)
			if e != nil {
				r.Status = "error"
			}
			concurrentResults <- r
		}()
	}
	wg.Wait()
	close(concurrentResults)
	duplicates := 0
	for r := range concurrentResults {
		if r.Status != "accepted" {
			t.Fatal("concurrent retry failed", r)
		}
		if r.Duplicate {
			duplicates++
		}
	}
	if duplicates != 1 || queryInt("SELECT last_seq FROM sync_users WHERE id=?", internal) != start+1 {
		t.Fatal("concurrent retry applied twice")
	}
	last := queryInt("SELECT last_seq FROM sync_users WHERE id=?", internal)
	logs := queryInt("SELECT COUNT(*) FROM sync_change_log WHERE user_id=?", internal)
	if last != logs {
		t.Fatal("sequence/log mismatch")
	}
	if queryInt("SELECT COUNT(*) FROM blocks") != 0 || queryInt("SELECT COUNT(*) FROM transactions") != 0 {
		t.Fatal("v2 mutation wrote legacy chain tables")
	}
}
