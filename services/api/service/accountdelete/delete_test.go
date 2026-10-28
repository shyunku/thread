package accountdelete

import (
	"regexp"
	"strings"
	"testing"
	"thread_api/service/database/migrations"
)

var (
	createTable = regexp.MustCompile(`(?i)^\s*CREATE TABLE\s+(\w+)`)
	alterTable  = regexp.MustCompile(`(?i)^\s*ALTER TABLE\s+(\w+)`)
	references  = regexp.MustCompile(`(?i)REFERENCES\s+(\w+)\s*\(`)
)

// Foreign keys of the legacy tables (thread.ddl), which no migration creates.
var legacyParents = map[string][]string{
	"admin_master": {"user_master"},
	"transactions": {"user_master"},
	"blocks":       {"transactions"},
}

// A new table in a migration must be added to the delete list (or this test
// changed on purpose), and every child must be deleted before its parent.
func TestTargetsCoverEverySchemaTable(t *testing.T) {
	tables := map[string]bool{}
	parents := map[string][]string{}
	for child, list := range legacyParents {
		tables[child] = true
		parents[child] = append(parents[child], list...)
	}
	for _, m := range migrations.Server {
		for name := range m.RequiredTables {
			tables[name] = true
		}
		for _, statement := range m.Statements {
			match := createTable.FindStringSubmatch(statement)
			if match == nil {
				match = alterTable.FindStringSubmatch(statement)
			} else {
				tables[match[1]] = true
			}
			if match == nil {
				continue
			}
			for _, ref := range references.FindAllStringSubmatch(statement, -1) {
				parents[match[1]] = append(parents[match[1]], ref[1])
			}
		}
	}
	position := map[string]int{}
	for i, target := range targets {
		if _, dup := position[target.table]; dup {
			t.Fatalf("%s listed twice", target.table)
		}
		position[target.table] = i
		if !tables[target.table] {
			t.Errorf("%s is not a schema table", target.table)
		}
		if strings.Count(target.where, "?") != len(target.args) {
			t.Errorf("%s: placeholders do not match args", target.table)
		}
	}
	for table := range tables {
		if _, ok := position[table]; !ok {
			t.Errorf("%s is not deleted with the account", table)
		}
	}
	for child, list := range parents {
		for _, parent := range list {
			if parent != child && position[child] > position[parent] {
				t.Errorf("%s must be deleted before its parent %s", child, parent)
			}
		}
	}
}
