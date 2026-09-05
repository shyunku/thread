package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"thread_api/service/syncmigration"
)

func TestWritePlanNeverOverwrites(t *testing.T) {
	file := filepath.Join(t.TempDir(), "plan.json")
	plan := &syncmigration.Plan{Summary: syncmigration.Summary{FormatVersion: 1, UserID: "fixture"}}
	if e := writePlan(file, plan); e != nil {
		t.Fatal(e)
	}
	before, e := os.ReadFile(file)
	if e != nil {
		t.Fatal(e)
	}
	var decoded syncmigration.Plan
	if e = json.Unmarshal(before, &decoded); e != nil || decoded.UserID != "fixture" {
		t.Fatal("invalid exported plan")
	}
	plan.UserID = "replacement"
	if e = writePlan(file, plan); e == nil {
		t.Fatal("overwrote existing file")
	}
	after, _ := os.ReadFile(file)
	if !bytes.Equal(before, after) {
		t.Fatal("existing file changed")
	}
}
func TestCLIRequiresExplicitSource(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if e := run(nil, &stdout, &stderr); e == nil {
		t.Fatal("missing user accepted")
	}
	t.Setenv("THREAD_PREFLIGHT_TEST_MISSING", "")
	if e := run([]string{"-user", "fixture", "-dsn-env", "THREAD_PREFLIGHT_TEST_MISSING"}, &stdout, &stderr); e == nil {
		t.Fatal("implicit DB config accepted")
	}
	if stdout.Len() != 0 {
		t.Fatal("failure emitted data")
	}
}
