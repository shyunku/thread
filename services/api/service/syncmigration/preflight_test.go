package syncmigration

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"thread_api/service/state"
)

func fixture() state.State {
	a := state.Task{Id: "a", Title: "title", Memo: "private memo", CreatedAt: 123, DoneAt: 456, DueDate: 789, Done: true, Next: "b", RepeatPeriod: "month", RepeatStartAt: 100,
		Subtasks: map[string]state.Subtask{"s": {Id: "s", Title: "child", CreatedAt: 12, DoneAt: 34, DueDate: 56, Done: true}}, Categories: map[string]bool{"c": true}}
	b := state.Task{Id: "b", Title: "second", Subtasks: map[string]state.Subtask{}, Categories: map[string]bool{}}
	return state.State{Tasks: map[string]state.Task{"a": a, "b": b}, Categories: map[string]state.Category{"c": {Id: "c", Title: "category", Secret: true, Locked: true, Color: "#abcdef", CreatedAt: 987}}}
}
func sourceOf(st state.State) Source {
	data, _ := json.Marshal(st)
	return Source{UserID: "user-a", SnapshotNumber: 1, Blocks: []BlockMeta{{Number: 1, BlockHash: "block", TxHash: "tx", TxUserID: "user-a", TxVersion: 2, TxType: 0, TxDigest: "digest"}}, Snapshot: data}
}
func TestPreservesFieldsAndStablePlan(t *testing.T) {
	source := sourceOf(fixture())
	original := append([]byte{}, source.Snapshot...)
	first, e := BuildPlan(source)
	if e != nil {
		t.Fatal(e)
	}
	second, e := BuildPlan(source)
	if e != nil {
		t.Fatal(e)
	}
	if !reflect.DeepEqual(first, second) || !bytes.Equal(original, source.Snapshot) {
		t.Fatal("not deterministic or mutated source")
	}
	task := first.Rows.Tasks[0]
	if task["id"] != "a" || task["memo"] != "private memo" || task["repeat_period"] != "month" || task["done_at"] != json.Number("456") || task["repeat_start_at"] != json.Number("100") {
		t.Fatal("task fields lost")
	}
	if task["sort_rank"] != "4294967296" || first.Rows.Tasks[1]["id"] != "b" {
		t.Fatal("order lost")
	}
	if _, ok := task["next"]; ok {
		t.Fatal("legacy next leaked into canonical row")
	}
	if first.Rows.Subtasks[0]["task_id"] != "a" || first.Rows.Subtasks[0]["done_at"] != json.Number("34") {
		t.Fatal("subtask fields lost")
	}
	if first.Rows.Categories[0]["locked"] != true || first.Rows.Categories[0]["secret"] != true || first.Rows.Categories[0]["color"] != "#abcdef" {
		t.Fatal("category fields lost")
	}
	if first.Counts["taskCategories"] != 1 {
		t.Fatal("relationship lost")
	}
	summary, _ := json.Marshal(first.Summary)
	if bytes.Contains(summary, []byte("private memo")) || bytes.Contains(summary, []byte("title")) {
		t.Fatal("summary exposes content")
	}
	source.Blocks[0].TxDigest = "changed"
	changed, _ := BuildPlan(source)
	if first.SourceChecksum == changed.SourceChecksum {
		t.Fatal("provenance mismatch not detected")
	}
}
func TestRejectsInvalidState(t *testing.T) {
	cases := []struct {
		name   string
		change func(*state.State)
	}{
		{"missing next", func(s *state.State) { a := s.Tasks["a"]; a.Next = "missing"; s.Tasks["a"] = a }},
		{"cycle", func(s *state.State) { b := s.Tasks["b"]; b.Next = "a"; s.Tasks["b"] = b }},
		{"multiple heads", func(s *state.State) { a := s.Tasks["a"]; a.Next = ""; s.Tasks["a"] = a }},
		{"duplicate predecessor", func(s *state.State) { b := s.Tasks["b"]; b.Next = "b"; s.Tasks["b"] = b }},
		{"orphan category", func(s *state.State) { delete(s.Categories, "c") }},
		{"false membership", func(s *state.State) { s.Tasks["a"].Categories["c"] = false }},
		{"wrong task ID", func(s *state.State) { a := s.Tasks["a"]; a.Id = "wrong"; s.Tasks["a"] = a }},
		{"wrong child ID", func(s *state.State) { s.Tasks["a"].Subtasks["s"] = state.Subtask{Id: "wrong"} }},
		{"wrong category ID", func(s *state.State) { s.Categories["c"] = state.Category{Id: "wrong"} }},
		{"unsupported repeat", func(s *state.State) { a := s.Tasks["a"]; a.RepeatPeriod = "hour"; s.Tasks["a"] = a }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			st := fixture()
			tc.change(&st)
			if _, e := BuildPlan(sourceOf(st)); e == nil {
				t.Fatal("invalid state accepted")
			}
		})
	}
}
func TestStrictJSON(t *testing.T) {
	cases := []string{
		`{"tasks":{},"tasks":{},"categories":{}}`,
		`{"tasks":null,"categories":{}}`,
		`{"tasks":{},"categories":{},"unknown":true}`,
		`{"tasks":{}}`,
		`{"tasks":{},"categories":{}}{}`,
		`{"tasks":{"x":{"tid":"x"}},"categories":{}}`,
	}
	for i, raw := range cases {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			source := sourceOf(fixture())
			source.Snapshot = []byte(raw)
			if _, e := BuildPlan(source); e == nil {
				t.Fatal("lossy JSON accepted")
			}
		})
	}
}
func TestBlockProvenance(t *testing.T) {
	changes := []func(*Source){
		func(s *Source) { s.Blocks = append(s.Blocks, s.Blocks[0]) },
		func(s *Source) { s.Blocks[0].TxUserID = "another-user" },
		func(s *Source) { s.Blocks[0].TxVersion = 999 },
		func(s *Source) { s.Blocks[0].TxType = 999 },
		func(s *Source) { s.Blocks[0].TxHash = "" },
		func(s *Source) { s.SnapshotNumber = 2 },
		func(s *Source) { s.Blocks = nil; s.SnapshotNumber = 0 },
	}
	for i, change := range changes {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			source := sourceOf(fixture())
			change(&source)
			if _, e := BuildPlan(source); e == nil {
				t.Fatal("ambiguous provenance accepted")
			}
		})
	}
	empty := Source{UserID: "new", Snapshot: []byte(`{"tasks":{},"categories":{}}`)}
	if p, e := BuildPlan(empty); e != nil || p.Counts["tasks"] != 0 {
		t.Fatal("valid empty account rejected")
	}
	gap := sourceOf(fixture())
	gap.Blocks[0].Number = 2
	gap.SnapshotNumber = 2
	if p, e := BuildPlan(gap); e != nil || len(p.Warnings) != 1 {
		t.Fatal("history gap not reported")
	}
}
func TestAllLegacyTransactionTypes(t *testing.T) {
	for _, kind := range []int64{0, 10000, 10001, 10002, 10003, 10004, 10005, 10006, 10007, 10100, 10101, 11000, 11001, 11002, 11003, 11004, 12000, 12001, 12002} {
		t.Run(fmt.Sprint(kind), func(t *testing.T) {
			s := sourceOf(fixture())
			s.Blocks[0].TxType = kind
			if _, e := BuildPlan(s); e != nil {
				t.Fatal(e)
			}
		})
	}
}
func TestLargeSnapshotAndDisconnectedCycle(t *testing.T) {
	st := state.State{Tasks: map[string]state.Task{}, Categories: map[string]state.Category{}}
	for i := 0; i < 10000; i++ {
		id := fmt.Sprintf("task-%05d", i)
		next := ""
		if i < 9999 {
			next = fmt.Sprintf("task-%05d", i+1)
		}
		st.Tasks[id] = state.Task{Id: id, Next: next, Subtasks: map[string]state.Subtask{}, Categories: map[string]bool{}}
	}
	p, e := BuildPlan(sourceOf(st))
	if e != nil || len(p.Rows.Tasks) != 10000 {
		t.Fatal("large snapshot failed", e)
	}
	a := st.Tasks["task-00000"]
	a.Next = ""
	st.Tasks[a.Id] = a
	tail := st.Tasks["task-09999"]
	tail.Next = "task-00001"
	st.Tasks[tail.Id] = tail
	if _, e = BuildPlan(sourceOf(st)); e == nil || !strings.Contains(e.Error(), "CYCLIC") {
		t.Fatal("disconnected cycle accepted", e)
	}
}
