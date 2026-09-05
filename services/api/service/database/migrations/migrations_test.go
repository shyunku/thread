package migrations

import "testing"

func TestValidateHistory(t *testing.T) {
	manifest := []Migration{{Version: 1, Name: "baseline"}, {Version: 2, Name: "expand", Statements: []string{"CREATE TABLE t(id INT)"}}}
	good := Applied{Version: 1, Name: "baseline", Checksum: manifest[0].Checksum(), State: "applied"}
	tests := []struct {
		name  string
		rows  []Applied
		valid bool
	}{
		{"empty", nil, true},
		{"applied", []Applied{good}, true},
		{"dirty", []Applied{{Version: 1, Name: good.Name, Checksum: good.Checksum, State: "applying"}}, false},
		{"checksum", []Applied{{Version: 1, Name: good.Name, Checksum: "changed", State: "applied"}}, false},
		{"renamed", []Applied{{Version: 1, Name: "renamed", Checksum: good.Checksum, State: "applied"}}, false},
		{"gap", []Applied{{Version: 2}}, false},
		{"downgrade", []Applied{good, {Version: 2, Name: "expand", Checksum: manifest[1].Checksum(), State: "applied"}, {Version: 3}}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if (Validate(manifest, tt.rows) == nil) != tt.valid {
				t.Fatal("unexpected history validation result")
			}
		})
	}
	if Validate([]Migration{{Version: 2, Name: "gap"}}, nil) == nil {
		t.Fatal("manifest gap accepted")
	}
	if Validate([]Migration{{Version: 1}}, nil) == nil {
		t.Fatal("unnamed migration accepted")
	}
}
func TestChecksumCoversSQLAndBaseline(t *testing.T) {
	a := Migration{Version: 1, Name: "one", RequiredTables: map[string][]string{"x": {"id"}}}
	b := a
	b.Statements = []string{"ALTER TABLE x ADD COLUMN name TEXT"}
	if a.Checksum() == b.Checksum() {
		t.Fatal("SQL omitted from checksum")
	}
	b = a
	b.RequiredTables = map[string][]string{"x": {"other"}}
	if a.Checksum() == b.Checksum() {
		t.Fatal("baseline omitted from checksum")
	}
	if Validate(Server, nil) != nil {
		t.Fatal("invalid shipped manifest")
	}
}
