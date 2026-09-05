package canonical

import (
	"encoding/json"
	"math/big"
	"strings"
	"testing"
	"time"
)

func TestRankArithmetic(t *testing.T) {
	if s, ok := between(nil, nil); !ok || s != "4294967296" {
		t.Fatal(s, ok)
	}
	if _, ok := between(big.NewInt(1), big.NewInt(2)); ok {
		t.Fatal("exhausted gap accepted")
	}
	if s, ok := between(big.NewInt(-10), big.NewInt(10)); !ok || s != "0" {
		t.Fatal("negative rank midpoint", s)
	}
	a, _ := new(big.Int).SetString("9007199254740993", 10)
	b := new(big.Int).Add(a, big.NewInt(16))
	if s, ok := between(a, b); !ok || s != "9007199254741001" {
		t.Fatal("rank precision lost", s)
	}
	if _, ok := between(rankMax, nil); ok {
		t.Fatal("decimal overflow accepted")
	}
}
func TestFieldValidation(t *testing.T) {
	if _, e := normalize("task", map[string]interface{}{"title": strings.Repeat("a", 65536)}, false, 123); e == nil {
		t.Fatal("title exceeds SQL TEXT capacity")
	}
	for _, fields := range []map[string]interface{}{
		{"sort_rank": "10"}, {"recurrence_generation": "1"}, {"created_at": int64(1)},
		{"title": nil}, {"done": 1}, {"due_date": nil}, {"due_date": "123"}, {"due_date": 1.5},
		{"repeat_period": "hour"}, {"done_at": int64(123)}, {"done": false, "done_at": int64(123)},
	} {
		if _, e := normalize("task", fields, false, 123); e == nil {
			t.Fatalf("invalid fields accepted: %v", fields)
		}
	}
	fields, e := normalize("task", map[string]interface{}{"done": true}, false, 123)
	if e != nil || fields["done_at"] != int64(123) {
		t.Fatal("completion timestamp not coupled")
	}
	fields, e = normalize("task", map[string]interface{}{"due_date": json.Number("1735689600000")}, false, 123)
	if e != nil || fields["due_date"] != int64(1735689600000) {
		t.Fatal("JSON integer not preserved")
	}
	for _, version := range []string{"01", "-1", "1.5", "18446744073709551616"} {
		if _, e := baseVersion(version); e == nil {
			t.Fatal("invalid base version", version)
		}
	}
}
func TestRecurrenceMatchesServerCalendar(t *testing.T) {
	cases := []struct {
		start, now, want time.Time
		period           string
	}{
		{time.Date(2025, 1, 31, 0, 0, 0, 0, time.UTC), time.Date(2025, 2, 1, 0, 0, 0, 0, time.UTC), time.Date(2025, 3, 3, 0, 0, 0, 0, time.UTC), "month"},
		{time.Date(2024, 2, 29, 0, 0, 0, 0, time.UTC), time.Date(2024, 3, 1, 0, 0, 0, 0, time.UTC), time.Date(2025, 3, 1, 0, 0, 0, 0, time.UTC), "year"},
		{time.Date(2026, 9, 1, 0, 0, 0, 0, time.FixedZone("KST", 9*3600)), time.Date(2026, 9, 5, 12, 0, 0, 0, time.FixedZone("KST", 9*3600)), time.Date(2026, 9, 6, 0, 0, 0, 0, time.FixedZone("KST", 9*3600)), "day"},
	}
	for _, tc := range cases {
		got, e := nextDue(tc.start.UnixMilli(), tc.start.UnixMilli(), tc.period, tc.now)
		if e != nil || got != tc.want.UnixMilli() {
			t.Fatalf("%s got %d want %d: %v", tc.period, got, tc.want.UnixMilli(), e)
		}
	}
	if _, e := nextDue(1, 1, "invalid", time.UnixMilli(0)); e == nil {
		t.Fatal("invalid period accepted")
	}
	if occurrenceID("u", "t", "0", "task") != occurrenceID("u", "t", "0", "task") {
		t.Fatal("unstable occurrence ID")
	}
	if occurrenceID("u", "t", "0", "task") == occurrenceID("other", "t", "0", "task") {
		t.Fatal("cross-user occurrence collision")
	}
	if occurrenceID("u", "t", "0", "task") == occurrenceID("u", "t", "1", "task") {
		t.Fatal("generation not part of identity")
	}
}
