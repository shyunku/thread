package migrations

import (
	"strings"
	"testing"
)

func TestVaultMigrationIsAdditive(t *testing.T) {
	m := vaultV6()
	if m.Version != 6 || len(m.Statements) != 4 {
		t.Fatal("unexpected vault manifest")
	}
	if Server[5].Checksum() != m.Checksum() {
		t.Fatal("vault migration missing from manifest")
	}
	for _, s := range m.Statements {
		if !strings.HasPrefix(strings.TrimSpace(s), "CREATE TABLE vault") {
			t.Fatal("non-additive vault migration")
		}
		for _, forbidden := range []string{"DROP ", "DELETE ", "UPDATE ", "ALTER ", "INSERT "} {
			if strings.Contains(strings.ToUpper(s), forbidden) {
				t.Fatal("existing data mutation in schema addition")
			}
		}
	}
	if !strings.Contains(m.Statements[0], "UNIQUE KEY vault_account(account_id)") {
		t.Fatal("missing account uniqueness")
	}
	if !strings.Contains(m.Statements[1], "PRIMARY KEY(vault_id,revision)") {
		t.Fatal("missing revision uniqueness")
	}
	if !strings.Contains(m.Statements[2], "REFERENCES vault_membership_events") {
		t.Fatal("missing approval provenance")
	}
	if !strings.Contains(m.Statements[3], "PRIMARY KEY(vault_id,recipient_device_id,key_generation)") {
		t.Fatal("missing recipient scope")
	}
}
