package canonical

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

type fieldKind int

const (
	textField fieldKind = iota
	boolField
	timeField
	decimalField
)

type definition struct {
	table    string
	fields   map[string]fieldKind
	defaults map[string]interface{}
}

var definitions = map[string]definition{
	"task": {"tasks", map[string]fieldKind{"title": textField, "memo": textField, "done": boolField, "done_at": timeField, "due_date": timeField, "repeat_period": textField, "repeat_start_at": timeField, "recurrence_generation": decimalField, "sort_rank": decimalField, "created_at": timeField},
		map[string]interface{}{"title": "", "memo": "", "done": false, "done_at": int64(0), "due_date": int64(0), "repeat_period": "", "repeat_start_at": int64(0), "recurrence_generation": "0", "sort_rank": "0", "created_at": int64(0)}},
	"category": {"categories", map[string]fieldKind{"title": textField, "secret": boolField, "locked": boolField, "color": textField, "created_at": timeField},
		map[string]interface{}{"title": "", "secret": false, "locked": false, "color": "", "created_at": int64(0)}},
	"subtask": {"subtasks", map[string]fieldKind{"title": textField, "done": boolField, "done_at": timeField, "due_date": timeField, "created_at": timeField},
		map[string]interface{}{"title": "", "done": false, "done_at": int64(0), "due_date": int64(0), "created_at": int64(0)}},
}

type entity struct {
	kind, id, parent string
	fields           map[string]interface{}
	versions         map[string]string
	version          uint64
	deleted          bool
}

func validID(id string) bool {
	return utf8.ValidString(id) && strings.TrimSpace(id) != "" && utf8.RuneCountInString(id) <= 255
}
func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
func text(v interface{}) string {
	if b, ok := v.([]byte); ok {
		return string(b)
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
func integer(v interface{}) (int64, error) {
	switch n := v.(type) {
	case int:
		return int64(n), nil
	case int64:
		return n, nil
	case json.Number:
		return n.Int64()
	case float64:
		if math.IsNaN(n) || math.IsInf(n, 0) || math.Trunc(n) != n || n > 9007199254740991 || n < -9007199254740991 {
			return 0, fail("INVALID_NUMBER")
		}
		return int64(n), nil
	}
	return strconv.ParseInt(text(v), 10, 64)
}
func where(kind, id, parent, user string) (string, []interface{}) {
	if kind == "subtask" {
		return "user_id=? AND task_id=? AND id=?", []interface{}{user, parent, id}
	}
	return "user_id=? AND id=?", []interface{}{user, id}
}
func (c *mutationContext) load(kind, id, parent string) (*entity, error) {
	def, ok := definitions[kind]
	if !ok {
		return nil, fail("INVALID_ENTITY_TYPE")
	}
	fields := sortedKeys(def.fields)
	columns := append(append([]string{}, fields...), "version", "deleted_at", "field_versions")
	cond, args := where(kind, id, parent, c.user)
	raw := make([]interface{}, len(columns))
	dest := make([]interface{}, len(raw))
	for i := range raw {
		dest[i] = &raw[i]
	}
	err := c.tx.QueryRowContext(c.ctx, "SELECT "+strings.Join(columns, ",")+" FROM "+def.table+" WHERE "+cond, args...).Scan(dest...)
	if err == sql.ErrNoRows {
		return nil, fail("ENTITY_NOT_FOUND")
	}
	if err != nil {
		return nil, err
	}
	row := &entity{kind: kind, id: id, parent: parent, fields: map[string]interface{}{}, versions: map[string]string{}, deleted: raw[len(fields)+1] != nil}
	row.version, err = strconv.ParseUint(stringValue(raw[len(fields)]), 10, 64)
	if err != nil {
		return nil, err
	}
	if err = json.Unmarshal([]byte(text(raw[len(fields)+2])), &row.versions); err != nil {
		return nil, err
	}
	if row.versions == nil {
		return nil, fmt.Errorf("invalid stored field versions")
	}
	for _, key := range fields {
		if _, e := strconv.ParseUint(row.versions[key], 10, 64); e != nil {
			return nil, fmt.Errorf("invalid stored field version")
		}
	}
	for i, key := range fields {
		switch def.fields[key] {
		case textField:
			row.fields[key] = text(raw[i])
		case decimalField:
			row.fields[key] = stringValue(raw[i])
		case boolField:
			n, e := integer(raw[i])
			if e != nil {
				return nil, e
			}
			row.fields[key] = n != 0
		case timeField:
			n, e := integer(raw[i])
			if e != nil {
				return nil, e
			}
			row.fields[key] = n
		}
	}
	return row, nil
}
func stringValue(v interface{}) string {
	if n, ok := v.(int64); ok {
		return strconv.FormatInt(n, 10)
	}
	if n, ok := v.(uint64); ok {
		return strconv.FormatUint(n, 10)
	}
	return text(v)
}
func (c *mutationContext) live(kind, id, parent string) (*entity, error) {
	row, e := c.load(kind, id, parent)
	if e != nil {
		return nil, e
	}
	if row.deleted {
		return nil, fail("ENTITY_DELETED")
	}
	return row, nil
}
func (c *mutationContext) insert(kind, id, parent string, fields map[string]interface{}) (*entity, error) {
	if prior, e := c.load(kind, id, parent); e == nil {
		if prior.deleted {
			return nil, fail("ENTITY_ID_REUSED")
		}
		return nil, fail("ENTITY_EXISTS")
	} else if e != fault("ENTITY_NOT_FOUND") {
		return nil, e
	}
	def := definitions[kind]
	seq := strconv.FormatUint(c.seq, 10)
	versions := map[string]string{}
	names := []string{"user_id", "id"}
	args := []interface{}{c.user, id}
	if kind == "subtask" {
		names = append(names, "task_id")
		args = append(args, parent)
	}
	for _, key := range sortedKeys(fields) {
		names = append(names, key)
		args = append(args, fields[key])
		versions[key] = seq
	}
	encoded, _ := json.Marshal(versions)
	names = append(names, "updated_at", "version", "field_versions")
	args = append(args, c.now.UnixMilli(), seq, encoded)
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(args)), ",")
	if _, e := c.tx.ExecContext(c.ctx, "INSERT INTO "+def.table+"("+strings.Join(names, ",")+") VALUES ("+placeholders+")", args...); e != nil {
		return nil, e
	}
	c.record(kind, id, parent, "create", fields)
	return &entity{kind: kind, id: id, parent: parent, fields: fields, versions: versions, version: c.seq}, nil
}
func (c *mutationContext) update(row *entity, fields map[string]interface{}, deleted bool) error {
	fresh, e := c.load(row.kind, row.id, row.parent)
	if e != nil {
		return e
	}
	row.versions = fresh.versions
	def := definitions[row.kind]
	seq := strconv.FormatUint(c.seq, 10)
	parts := []string{}
	args := []interface{}{}
	for _, key := range sortedKeys(fields) {
		if _, ok := def.fields[key]; !ok {
			return fail("INVALID_INTERNAL_FIELD")
		}
		parts = append(parts, key+"=?")
		args = append(args, fields[key])
		row.fields[key] = fields[key]
		row.versions[key] = seq
	}
	if deleted {
		parts = append(parts, "deleted_at=?")
		args = append(args, c.now.UnixMilli())
		row.deleted = true
		row.versions["deleted_at"] = seq
	}
	encoded, _ := json.Marshal(row.versions)
	parts = append(parts, "updated_at=?", "version=?", "field_versions=?")
	args = append(args, c.now.UnixMilli(), seq, encoded)
	cond, identity := where(row.kind, row.id, row.parent, c.user)
	args = append(args, identity...)
	if _, e := c.tx.ExecContext(c.ctx, "UPDATE "+def.table+" SET "+strings.Join(parts, ",")+" WHERE "+cond, args...); e != nil {
		return e
	}
	op := "patch"
	if deleted {
		op = "delete"
		fields["deleted_at"] = c.now.UnixMilli()
	}
	c.record(row.kind, row.id, row.parent, op, fields)
	row.version = c.seq
	return nil
}
func normalize(kind string, input map[string]interface{}, create bool, now int64) (map[string]interface{}, error) {
	def := definitions[kind]
	fields := map[string]interface{}{}
	if create {
		for k, v := range def.defaults {
			fields[k] = v
		}
		fields["created_at"] = now
	}
	for key, value := range input {
		fk, ok := def.fields[key]
		if !ok || fk == decimalField || (!create && key == "created_at") {
			return nil, fail("INVALID_FIELD")
		}
		switch fk {
		case textField:
			s, ok := value.(string)
			if !ok || !utf8.ValidString(s) || len(s) > 1024*1024 {
				return nil, fail("INVALID_TEXT")
			}
			if key == "color" && len(s) > 32 {
				return nil, fail("INVALID_COLOR")
			}
			if key == "title" && len(s) > 65535 {
				return nil, fail("TITLE_TOO_LARGE")
			}
			if key == "repeat_period" && s != "" && s != "day" && s != "week" && s != "month" && s != "year" {
				return nil, fail("INVALID_REPEAT_PERIOD")
			}
			fields[key] = s
		case boolField:
			b, ok := value.(bool)
			if !ok {
				return nil, fail("INVALID_BOOLEAN")
			}
			fields[key] = b
		case timeField:
			if _, ok := value.(string); ok {
				return nil, fail("INVALID_TIMESTAMP")
			}
			n, e := integer(value)
			if e != nil || n < 0 || n > 253402300799999 {
				return nil, fail("INVALID_TIMESTAMP")
			}
			fields[key] = n
		}
	}
	if _, hasAt := input["done_at"]; hasAt {
		if _, hasDone := input["done"]; !hasDone {
			return nil, fail("DONE_FIELDS_REQUIRED")
		}
	}
	if done, ok := fields["done"].(bool); ok {
		if done {
			if _, given := input["done_at"]; !given {
				fields["done_at"] = now
			}
		} else {
			if fields["done_at"] != nil && fields["done_at"] != int64(0) {
				return nil, fail("INVALID_DONE_FIELDS")
			}
			fields["done_at"] = int64(0)
		}
	}
	return fields, nil
}
