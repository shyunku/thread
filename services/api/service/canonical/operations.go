package canonical

import (
	"database/sql"
	"strconv"
)

func (c *mutationContext) execute(m Mutation) error {
	if m.Generation != "" && m.Operation != "completeRecurringTask" {
		return fail("UNEXPECTED_GENERATION")
	}
	if (m.AnchorID != "" || m.After) && (m.EntityType != "task" || (m.Operation != "create" && m.Operation != "move")) {
		return fail("UNEXPECTED_ANCHOR")
	}
	if m.After && m.AnchorID == "" {
		return fail("INVALID_ANCHOR")
	}
	if m.AnchorID != "" && !validID(m.AnchorID) {
		return fail("INVALID_ANCHOR")
	}
	if len(m.CategoryIDs) > 0 && (m.EntityType != "task" || m.Operation != "create") {
		return fail("UNEXPECTED_CATEGORIES")
	}
	if len(m.CategoryIDs) > 1000 {
		return fail("TOO_MANY_CATEGORIES")
	}
	if m.Operation == "delete" && len(m.Changes) > 0 {
		return fail("UNEXPECTED_FIELDS")
	}
	if !validID(m.EntityID) {
		return fail("INVALID_ENTITY_ID")
	}
	if m.EntityType == "taskCategory" {
		if !validID(m.ParentID) || (m.Operation != "add" && m.Operation != "remove") || len(m.Changes) > 0 {
			return fail("INVALID_RELATION_REQUEST")
		}
		base, e := baseVersion(m.BaseVersion)
		if e != nil {
			return e
		}
		if _, e = c.live("task", m.ParentID, ""); e != nil {
			return e
		}
		if _, e = c.live("category", m.EntityID, ""); e != nil {
			return e
		}
		return c.setLink(m.ParentID, m.EntityID, m.Operation == "add", base)
	}
	if _, ok := definitions[m.EntityType]; !ok {
		return fail("INVALID_ENTITY_TYPE")
	}
	if m.EntityType == "subtask" {
		if !validID(m.ParentID) {
			return fail("INVALID_PARENT")
		}
		if _, e := c.live("task", m.ParentID, ""); e != nil {
			return e
		}
	} else if m.ParentID != "" {
		return fail("UNEXPECTED_PARENT")
	}
	base, e := baseVersion(m.BaseVersion)
	if e != nil {
		return e
	}
	if m.Operation == "create" {
		if base != 0 {
			return fail("INVALID_CREATE_VERSION")
		}
		fields, e := normalize(m.EntityType, m.Changes, true, c.now.UnixMilli())
		if e != nil {
			return e
		}
		if m.EntityType == "task" {
			if e = prepareSchedule(fields); e != nil {
				return e
			}
			rank, e := c.newRank("", m.AnchorID, m.After)
			if e != nil {
				return e
			}
			fields["sort_rank"] = rank
		}
		_, e = c.insert(m.EntityType, m.EntityID, m.ParentID, fields)
		if e != nil {
			return e
		}
		for _, category := range m.CategoryIDs {
			if !validID(category) {
				return fail("INVALID_CATEGORY_ID")
			}
			if _, e = c.live("category", category, ""); e != nil {
				return e
			}
			if e = c.setLink(m.EntityID, category, true, 0); e != nil {
				return e
			}
		}
		return nil
	}
	row, e := c.live(m.EntityType, m.EntityID, m.ParentID)
	if e != nil {
		return e
	}
	if base > row.version {
		return fail("INVALID_BASE_VERSION")
	}
	switch m.Operation {
	case "patch":
		if len(m.Changes) == 0 {
			return fail("EMPTY_PATCH")
		}
		fields, e := normalize(m.EntityType, m.Changes, false, c.now.UnixMilli())
		if e != nil {
			return e
		}
		if m.EntityType == "task" {
			if fields["done"] == true && row.fields["repeat_period"] != "" {
				return fail("RECURRING_COMPLETION_REQUIRED")
			}
			combined := map[string]interface{}{}
			for k, v := range row.fields {
				combined[k] = v
			}
			for k, v := range fields {
				combined[k] = v
			}
			if e = prepareSchedule(combined); e != nil {
				return e
			}
			if combined["repeat_start_at"] != row.fields["repeat_start_at"] {
				fields["repeat_start_at"] = combined["repeat_start_at"]
			}
			changedRule := false
			for _, k := range []string{"repeat_period", "repeat_start_at", "due_date"} {
				if v, ok := fields[k]; ok && v != row.fields[k] {
					changedRule = true
				}
			}
			if changedRule {
				gen, e := strconv.ParseUint(row.fields["recurrence_generation"].(string), 10, 64)
				if e != nil {
					return e
				}
				if gen == ^uint64(0) {
					return fail("GENERATION_EXHAUSTED")
				}
				fields["recurrence_generation"] = strconv.FormatUint(gen+1, 10)
			}
		}
		for key := range fields {
			if v, e := strconv.ParseUint(row.versions[key], 10, 64); e == nil && v > base {
				c.conflicts[key] = true
			}
		}
		return c.update(row, fields, false)
	case "delete":
		return c.deleteEntity(row)
	case "move":
		if m.EntityType != "task" || !validID(m.AnchorID) || len(m.Changes) > 0 {
			return fail("INVALID_MOVE")
		}
		if m.EntityID == m.AnchorID {
			return nil
		}
		rank, e := c.newRank(m.EntityID, m.AnchorID, m.After)
		if e != nil {
			return e
		}
		if v, _ := strconv.ParseUint(row.versions["sort_rank"], 10, 64); v > base {
			c.conflicts["sort_rank"] = true
		}
		return c.update(row, map[string]interface{}{"sort_rank": rank}, false)
	case "completeRecurringTask":
		if m.EntityType != "task" {
			return fail("INVALID_COMPLETION")
		}
		return c.complete(m, row)
	default:
		return fail("INVALID_OPERATION")
	}
}
func baseVersion(value string) (uint64, error) {
	if value == "" {
		return 0, nil
	}
	n, e := strconv.ParseUint(value, 10, 64)
	if e != nil || strconv.FormatUint(n, 10) != value {
		return 0, fail("INVALID_BASE_VERSION")
	}
	return n, nil
}
func prepareSchedule(fields map[string]interface{}) error {
	if fields["repeat_period"] != "" {
		if fields["repeat_start_at"] == int64(0) {
			fields["repeat_start_at"] = fields["due_date"]
		}
		if fields["repeat_start_at"].(int64) <= 0 || fields["due_date"].(int64) <= 0 {
			return fail("REPEAT_DATE_REQUIRED")
		}
	}
	return nil
}
func (c *mutationContext) ids(query string, args ...interface{}) ([]string, error) {
	rows, e := c.tx.QueryContext(c.ctx, query, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			return nil, e
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
func (c *mutationContext) deleteEntity(row *entity) error {
	if row.kind == "category" {
		var count int
		if e := c.tx.QueryRowContext(c.ctx, "SELECT COUNT(*) FROM task_categories WHERE user_id=? AND category_id=? AND present=true", c.user, row.id).Scan(&count); e != nil {
			return e
		}
		if count > 0 {
			return fail("CATEGORY_IN_USE")
		}
	}
	if row.kind == "task" {
		ids, e := c.ids("SELECT id FROM subtasks WHERE user_id=? AND task_id=? AND deleted_at IS NULL ORDER BY id", c.user, row.id)
		if e != nil {
			return e
		}
		for _, id := range ids {
			child, e := c.live("subtask", id, row.id)
			if e != nil {
				return e
			}
			if e = c.update(child, map[string]interface{}{}, true); e != nil {
				return e
			}
		}
		cats, e := c.ids("SELECT category_id FROM task_categories WHERE user_id=? AND task_id=? AND present=true ORDER BY category_id", c.user, row.id)
		if e != nil {
			return e
		}
		for _, id := range cats {
			if e = c.setLink(row.id, id, false, 0); e != nil {
				return e
			}
		}
	}
	return c.update(row, map[string]interface{}{}, true)
}
func (c *mutationContext) setLink(task, category string, present bool, base uint64) error {
	var old bool
	var version uint64
	e := c.tx.QueryRowContext(c.ctx, "SELECT present,version FROM task_categories WHERE user_id=? AND task_id=? AND category_id=?", c.user, task, category).Scan(&old, &version)
	if e != nil && e != sql.ErrNoRows {
		return e
	}
	if base > version {
		return fail("INVALID_BASE_VERSION")
	}
	if e == nil && old == present {
		return nil
	}
	if version > base {
		c.conflicts["present"] = true
	}
	seq := strconv.FormatUint(c.seq, 10)
	_, e = c.tx.ExecContext(c.ctx, "INSERT INTO task_categories(user_id,task_id,category_id,present,updated_at,version) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE present=VALUES(present),updated_at=VALUES(updated_at),version=VALUES(version)",
		c.user, task, category, present, c.now.UnixMilli(), seq)
	if e != nil {
		return e
	}
	c.record("taskCategory", category, task, "patch", map[string]interface{}{"present": present})
	return nil
}
