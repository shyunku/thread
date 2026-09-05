package canonical

import (
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"strconv"
	"time"
)

func occurrenceID(uid, task, generation, child string) string {
	encoded, _ := json.Marshal([]string{uid, task, generation, child})
	return uuid.NewSHA1(uuid.NameSpaceOID, encoded).String()
}
func nextDue(start, due int64, period string, now time.Time) (int64, error) {
	switch period {
	case "day", "week", "month", "year":
	default:
		return 0, fail("INVALID_REPEAT_PERIOD")
	}
	if start <= 0 || due <= 0 {
		return 0, fail("REPEAT_DATE_REQUIRED")
	}
	next := time.UnixMilli(start).In(now.Location())
	for i := 0; i < 100000; i++ {
		if next.UnixMilli() >= now.UnixMilli() && next.UnixMilli() > due {
			if next.Year() > 9999 {
				return 0, fail("RECURRENCE_RANGE")
			}
			return next.UnixMilli(), nil
		}
		switch period {
		case "day":
			next = next.AddDate(0, 0, 1)
		case "week":
			next = next.AddDate(0, 0, 7)
		case "month":
			next = next.AddDate(0, 1, 0)
		case "year":
			next = next.AddDate(1, 0, 0)
		default:
			return 0, fail("INVALID_REPEAT_PERIOD")
		}
	}
	return 0, fail("RECURRENCE_RANGE")
}
func (c *mutationContext) complete(m Mutation, row *entity) error {
	generation, e := strconv.ParseUint(m.Generation, 10, 64)
	if e != nil || strconv.FormatUint(generation, 10) != m.Generation {
		return fail("INVALID_GENERATION")
	}
	var old []byte
	e = c.tx.QueryRowContext(c.ctx, "SELECT result FROM sync_occurrences WHERE user_id=? AND task_id=? AND generation=?", c.user, row.id, m.Generation).Scan(&old)
	if e == nil {
		var prior Result
		if e = json.Unmarshal(old, &prior); e != nil {
			return e
		}
		c.reused = &prior
		return nil
	}
	if e != sql.ErrNoRows {
		return e
	}
	if row.fields["recurrence_generation"] != m.Generation {
		return fail("STALE_OCCURRENCE")
	}
	period := row.fields["repeat_period"].(string)
	if period == "" {
		return fail("NOT_RECURRING")
	}
	doneAt := c.now.UnixMilli()
	for k, v := range m.Changes {
		if k != "done_at" {
			return fail("INVALID_COMPLETION_FIELD")
		}
		if _, ok := v.(string); ok {
			return fail("INVALID_TIMESTAMP")
		}
		doneAt, e = integer(v)
		if e != nil || doneAt < 0 || doneAt > 253402300799999 {
			return fail("INVALID_TIMESTAMP")
		}
	}
	due, e := nextDue(row.fields["repeat_start_at"].(int64), row.fields["due_date"].(int64), period, c.now)
	if e != nil {
		return e
	}
	nextGen, e := nextGeneration(m.Generation)
	if e != nil {
		return e
	}
	newID := occurrenceID(c.uid, row.id, m.Generation, "task")
	fields := map[string]interface{}{}
	for k, v := range row.fields {
		fields[k] = v
	}
	fields["done"] = true
	fields["done_at"] = doneAt
	fields["repeat_period"] = ""
	fields["repeat_start_at"] = int64(0)
	fields["recurrence_generation"] = "0"
	fields["sort_rank"], e = c.newRank("", "", false)
	if e != nil {
		return e
	}
	clone, e := c.insert("task", newID, "", fields)
	if e != nil {
		return e
	}
	rank, e := c.newRank(newID, row.id, false)
	if e != nil {
		return e
	}
	if e = c.update(clone, map[string]interface{}{"sort_rank": rank}, false); e != nil {
		return e
	}
	c.generated["task"] = newID
	cats, e := c.ids("SELECT category_id FROM task_categories WHERE user_id=? AND task_id=? AND present=true ORDER BY category_id", c.user, row.id)
	if e != nil {
		return e
	}
	for _, cat := range cats {
		if e = c.setLink(newID, cat, true, 0); e != nil {
			return e
		}
	}
	children, e := c.ids("SELECT id FROM subtasks WHERE user_id=? AND task_id=? AND deleted_at IS NULL ORDER BY id", c.user, row.id)
	if e != nil {
		return e
	}
	diff := due - row.fields["due_date"].(int64)
	for _, sid := range children {
		child, e := c.live("subtask", sid, row.id)
		if e != nil {
			return e
		}
		copied := map[string]interface{}{}
		for k, v := range child.fields {
			copied[k] = v
		}
		clonedID := occurrenceID(c.uid, row.id, m.Generation, "subtask:"+sid)
		if _, e = c.insert("subtask", clonedID, newID, copied); e != nil {
			return e
		}
		c.generated["subtask:"+sid] = clonedID
		childDue := child.fields["due_date"].(int64)
		if childDue != 0 {
			childDue += diff
		}
		if childDue > 253402300799999 {
			return fail("RECURRENCE_RANGE")
		}
		if e = c.update(child, map[string]interface{}{"done": false, "done_at": int64(0), "due_date": childDue}, false); e != nil {
			return e
		}
	}
	if e = c.update(row, map[string]interface{}{"done": false, "done_at": int64(0), "due_date": due, "recurrence_generation": nextGen}, false); e != nil {
		return e
	}
	c.occurrenceTask = row.id
	c.occurrenceGeneration = m.Generation
	return nil
}
