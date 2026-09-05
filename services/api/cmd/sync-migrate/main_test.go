package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestRequiresExplicitActionAndOperatorConfirmations(t *testing.T) {
	for _, args := range [][]string{{}, {"--apply-all"}, {"--prepare-schema"}, {"--apply-all", "--backup-confirmed"}, {"--apply-all", "--writers-stopped"}, {"--check-all", "--verify-all"}} {
		var out bytes.Buffer
		if e := run(args, &out, &out); e == nil {
			t.Fatal("unsafe arguments accepted", args)
		}
	}
}
func TestNoImplicitEnvFileOrDefaultDatabase(t *testing.T) {
	t.Setenv("THREAD_MIGRATION_DSN", "")
	var out bytes.Buffer
	for _, args := range [][]string{{"--check-all"}, {"--verify-all"}, {"--apply-all", "--backup-confirmed", "--writers-stopped"}} {
		if e := run(args, &out, &out); e == nil || !strings.Contains(e.Error(), "DSN_REQUIRED") {
			t.Fatal(e)
		}
	}
}
