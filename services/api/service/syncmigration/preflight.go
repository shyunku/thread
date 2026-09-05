package syncmigration

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"thread_api/service/state"
	"unicode/utf8"
)

const MaxSnapshotBytes = 128 * 1024 * 1024

type BlockMeta struct {
	Number    int64  `json:"number,string"`
	BlockHash string `json:"blockHash"`
	TxHash    string `json:"txHash"`
	TxUserID  string `json:"txUserId"`
	TxVersion int    `json:"txVersion"`
	TxType    int64  `json:"txType"`
	TxDigest  string `json:"txDigest"`
}
type Source struct {
	UserID         string
	SnapshotNumber int64
	Blocks         []BlockMeta
	Snapshot       json.RawMessage
}
type Rows struct {
	Tasks          []map[string]interface{} `json:"tasks"`
	Subtasks       []map[string]interface{} `json:"subtasks"`
	Categories     []map[string]interface{} `json:"categories"`
	TaskCategories []map[string]interface{} `json:"taskCategories"`
}
type Summary struct {
	FormatVersion  int            `json:"formatVersion"`
	UserID         string         `json:"userId"`
	SnapshotNumber int64          `json:"snapshotNumber,string"`
	SourceChecksum string         `json:"sourceChecksum"`
	RowsChecksum   string         `json:"rowsChecksum"`
	Counts         map[string]int `json:"counts"`
	Warnings       []string       `json:"warnings"`
}
type Plan struct {
	Summary
	LegacyBlocks []BlockMeta `json:"legacyBlocks"`
	Rows         Rows        `json:"rows"`
}

func digest(data []byte) string { h := sha256.Sum256(data); return hex.EncodeToString(h[:]) }
func validID(id string) bool {
	return utf8.ValidString(id) && strings.TrimSpace(id) != "" && utf8.RuneCountInString(id) <= 255
}
func supportedType(t int64) bool {
	switch t {
	case 0, 10000, 10001, 10002, 10003, 10004, 10005, 10006, 10007, 10100, 10101, 11000, 11001, 11002, 11003, 11004, 12000, 12001, 12002:
		return true
	}
	return false
}
func keys(m map[string]interface{}) []string {
	r := make([]string, 0, len(m))
	for k := range m {
		r = append(r, k)
	}
	sort.Strings(r)
	return r
}

// Reject duplicate keys, arrays and nulls rather than silently losing legacy fields.
func walk(d *json.Decoder, depth int) error {
	if depth > 64 {
		return fmt.Errorf("SNAPSHOT_TOO_DEEP")
	}
	t, e := d.Token()
	if e != nil {
		return fmt.Errorf("INVALID_SNAPSHOT_JSON")
	}
	if t == nil {
		return fmt.Errorf("NULL_SNAPSHOT_FIELD")
	}
	if delim, ok := t.(json.Delim); ok {
		if delim != '{' {
			return fmt.Errorf("UNEXPECTED_SNAPSHOT_ARRAY")
		}
		seen := map[string]bool{}
		for d.More() {
			k, e := d.Token()
			if e != nil {
				return fmt.Errorf("INVALID_SNAPSHOT_JSON")
			}
			name, ok := k.(string)
			if !ok || seen[name] {
				return fmt.Errorf("DUPLICATE_SNAPSHOT_KEY")
			}
			seen[name] = true
			if e = walk(d, depth+1); e != nil {
				return e
			}
		}
		end, e := d.Token()
		if e != nil || end != json.Delim('}') {
			return fmt.Errorf("INVALID_SNAPSHOT_JSON")
		}
	}
	return nil
}
func decodeState(raw []byte) (*state.State, map[string]interface{}, error) {
	if len(raw) == 0 || len(raw) > MaxSnapshotBytes || !utf8.Valid(raw) {
		return nil, nil, fmt.Errorf("INVALID_SNAPSHOT_SIZE_OR_ENCODING")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if e := walk(d, 0); e != nil {
		return nil, nil, e
	}
	if _, e := d.Token(); e != io.EOF {
		return nil, nil, fmt.Errorf("TRAILING_SNAPSHOT_JSON")
	}
	var legacy state.State
	d = json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if e := d.Decode(&legacy); e != nil {
		return nil, nil, fmt.Errorf("UNSUPPORTED_SNAPSHOT_SCHEMA")
	}
	if legacy.Tasks == nil || legacy.Categories == nil {
		return nil, nil, fmt.Errorf("MISSING_SNAPSHOT_MAPS")
	}
	normalized, _ := json.Marshal(legacy)
	var a, b map[string]interface{}
	d = json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	_ = d.Decode(&a)
	d = json.NewDecoder(bytes.NewReader(normalized))
	d.UseNumber()
	_ = d.Decode(&b)
	if !reflect.DeepEqual(a, b) {
		return nil, nil, fmt.Errorf("LOSSY_SNAPSHOT_DECODE")
	}
	return &legacy, a, nil
}

var names = map[string]string{"tid": "id", "sid": "id", "cid": "id", "createdAt": "created_at", "doneAt": "done_at", "dueDate": "due_date", "repeatPeriod": "repeat_period", "repeatStartAt": "repeat_start_at"}

func flatten(input map[string]interface{}, exclude ...string) map[string]interface{} {
	result := map[string]interface{}{}
	skip := map[string]bool{}
	for _, k := range exclude {
		skip[k] = true
	}
	for k, v := range input {
		if skip[k] {
			continue
		}
		target := k
		if n, ok := names[k]; ok {
			target = n
		}
		result[target] = v
	}
	return result
}

// BuildPlan is deterministic, read-only, and never calls the legacy mutation engine.
func BuildPlan(source Source) (*Plan, error) {
	if !validID(source.UserID) {
		return nil, fmt.Errorf("INVALID_USER_ID")
	}
	blocks := append([]BlockMeta{}, source.Blocks...)
	sort.Slice(blocks, func(i, j int) bool { return blocks[i].Number < blocks[j].Number })
	warnings := []string{}
	last := int64(0)
	seenTx, seenBlock := map[string]bool{}, map[string]bool{}
	for _, b := range blocks {
		if b.Number <= 0 {
			return nil, fmt.Errorf("INVALID_BLOCK_NUMBER")
		}
		if b.Number == last {
			return nil, fmt.Errorf("DUPLICATE_BLOCK_NUMBER")
		}
		if b.TxUserID != source.UserID {
			return nil, fmt.Errorf("CROSS_USER_TRANSACTION")
		}
		if b.TxVersion != 2 || !supportedType(b.TxType) {
			return nil, fmt.Errorf("UNSUPPORTED_LEGACY_TRANSACTION")
		}
		if b.TxHash == "" || b.BlockHash == "" || b.TxDigest == "" {
			return nil, fmt.Errorf("MISSING_BLOCK_PROVENANCE")
		}
		if seenTx[b.TxHash] || seenBlock[b.BlockHash] {
			return nil, fmt.Errorf("DUPLICATE_BLOCK_PROVENANCE")
		}
		seenTx[b.TxHash], seenBlock[b.BlockHash] = true, true
		if b.Number != last+1 {
			warnings = append(warnings, "LEGACY_HISTORY_GAP")
		}
		last = b.Number
	}
	if source.SnapshotNumber != last {
		return nil, fmt.Errorf("SNAPSHOT_BOUNDARY_MISMATCH")
	}
	legacy, raw, e := decodeState(source.Snapshot)
	if e != nil {
		return nil, e
	}
	if len(legacy.Tasks) > 100000 {
		return nil, fmt.Errorf("SNAPSHOT_TASK_LIMIT")
	}
	if len(blocks) == 0 && (len(legacy.Tasks) > 0 || len(legacy.Categories) > 0) {
		return nil, fmt.Errorf("NONEMPTY_STATE_WITHOUT_BLOCK")
	}
	incoming := map[string]int{}
	for id, c := range legacy.Categories {
		if !validID(id) || c.Id != id {
			return nil, fmt.Errorf("INVALID_CATEGORY_ID")
		}
	}
	for id, t := range legacy.Tasks {
		if !validID(id) || t.Id != id {
			return nil, fmt.Errorf("INVALID_TASK_ID")
		}
		if t.Subtasks == nil || t.Categories == nil {
			return nil, fmt.Errorf("MISSING_TASK_MAPS")
		}
		switch t.RepeatPeriod {
		case "", "day", "week", "month", "year":
		default:
			return nil, fmt.Errorf("UNSUPPORTED_REPEAT_PERIOD")
		}
		if t.Next != "" {
			if _, ok := legacy.Tasks[t.Next]; !ok {
				return nil, fmt.Errorf("MISSING_NEXT_TASK")
			}
			incoming[t.Next]++
			if incoming[t.Next] > 1 {
				return nil, fmt.Errorf("MULTIPLE_PREVIOUS_TASKS")
			}
		}
		for cid, present := range t.Categories {
			if !present {
				return nil, fmt.Errorf("FALSE_CATEGORY_MEMBERSHIP")
			}
			if _, ok := legacy.Categories[cid]; !ok {
				return nil, fmt.Errorf("MISSING_CATEGORY")
			}
		}
		for sid, s := range t.Subtasks {
			if !validID(sid) || s.Id != sid {
				return nil, fmt.Errorf("INVALID_SUBTASK_ID")
			}
		}
	}
	heads := []string{}
	for id := range legacy.Tasks {
		if incoming[id] == 0 {
			heads = append(heads, id)
		}
	}
	if len(legacy.Tasks) > 0 && len(heads) != 1 {
		return nil, fmt.Errorf("INVALID_TASK_HEAD_COUNT")
	}
	order := []string{}
	seen := map[string]bool{}
	if len(heads) == 1 {
		for id := heads[0]; id != ""; id = legacy.Tasks[id].Next {
			if seen[id] {
				return nil, fmt.Errorf("TASK_ORDER_CYCLE")
			}
			seen[id] = true
			order = append(order, id)
		}
	}
	if len(order) != len(legacy.Tasks) {
		return nil, fmt.Errorf("TASK_ORDER_DISCONNECTED_OR_CYCLIC")
	}
	result := Rows{[]map[string]interface{}{}, []map[string]interface{}{}, []map[string]interface{}{}, []map[string]interface{}{}}
	tasks := raw["tasks"].(map[string]interface{})
	categories := raw["categories"].(map[string]interface{})
	for _, id := range keys(categories) {
		result.Categories = append(result.Categories, flatten(categories[id].(map[string]interface{})))
	}
	for i, id := range order {
		task := tasks[id].(map[string]interface{})
		row := flatten(task, "subtasks", "categories", "next")
		row["sort_rank"] = strconv.FormatUint(uint64(i+1)*(1<<32), 10)
		result.Tasks = append(result.Tasks, row)
		children := task["subtasks"].(map[string]interface{})
		for _, sid := range keys(children) {
			child := flatten(children[sid].(map[string]interface{}))
			child["task_id"] = id
			result.Subtasks = append(result.Subtasks, child)
		}
		for _, cid := range keys(task["categories"].(map[string]interface{})) {
			result.TaskCategories = append(result.TaskCategories, map[string]interface{}{"task_id": id, "category_id": cid, "present": true})
		}
	}
	rowsJSON, _ := json.Marshal(result)
	provenance, _ := json.Marshal(struct {
		User             string
		Number           int64
		Blocks           []BlockMeta
		SnapshotChecksum string
	}{source.UserID, last, blocks, digest(source.Snapshot)})
	return &Plan{Summary: Summary{1, source.UserID, last, digest(provenance), digest(rowsJSON),
		map[string]int{"tasks": len(result.Tasks), "subtasks": len(result.Subtasks), "categories": len(result.Categories), "taskCategories": len(result.TaskCategories), "legacyBlocks": len(blocks)}, warnings}, LegacyBlocks: blocks, Rows: result}, nil
}
