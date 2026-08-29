package state

import "github.com/google/uuid"

type Task struct {
	Id            string `json:"tid"`
	Title         string `json:"title"`
	CreatedAt     int64  `json:"createdAt"`
	DoneAt        int64  `json:"doneAt"`
	Memo          string `json:"memo"`
	Done          bool   `json:"done"`
	DueDate       int64  `json:"dueDate"`
	Next          string `json:"next"`
	RepeatPeriod  string `json:"repeatPeriod"`
	RepeatStartAt int64  `json:"repeatStartAt"`

	Subtasks   map[string]Subtask `json:"subtasks"`
	Categories map[string]bool    `json:"categories"`
}

func (t *Task) Copy() *Task {
	task := &Task{
		Id:            t.Id,
		Title:         t.Title,
		CreatedAt:     t.CreatedAt,
		DoneAt:        t.DoneAt,
		Memo:          t.Memo,
		Done:          t.Done,
		DueDate:       t.DueDate,
		Next:          t.Next,
		RepeatPeriod:  t.RepeatPeriod,
		RepeatStartAt: t.RepeatStartAt,
	}
	task.Subtasks = make(map[string]Subtask)
	for k, v := range t.Subtasks {
		task.Subtasks[k] = *v.Copy()
	}
	task.Categories = make(map[string]bool)
	for k, v := range t.Categories {
		task.Categories[k] = v
	}

	return task
}

// CopyNew creates clone with other task ID (and subordinates tasks)
func (t *Task) CopyNew() *Task {
	newTaskId := uuid.New().String()
	task := &Task{
		Id:            newTaskId,
		Title:         t.Title,
		CreatedAt:     t.CreatedAt,
		DoneAt:        t.DoneAt,
		Memo:          t.Memo,
		Done:          t.Done,
		DueDate:       t.DueDate,
		Next:          t.Next,
		RepeatPeriod:  t.RepeatPeriod,
		RepeatStartAt: t.RepeatStartAt,
	}
	task.Subtasks = make(map[string]Subtask)
	for _, v := range t.Subtasks {
		newSubtask := v.Copy()
		newSubtask.Id = uuid.New().String()
		task.Subtasks[newSubtask.Id] = *newSubtask
	}
	task.Categories = make(map[string]bool)
	for k, v := range t.Categories {
		task.Categories[k] = v
	}

	return task
}

type DirectionalTask struct {
	Task
	Prev string `json:"prev"`
}

type Subtask struct {
	Id        string `json:"sid"`
	Title     string `json:"title"`
	CreatedAt int64  `json:"createdAt"`
	DoneAt    int64  `json:"doneAt"`
	DueDate   int64  `json:"dueDate"`
	Done      bool   `json:"done"`
}

func (s *Subtask) Copy() *Subtask {
	return &Subtask{
		Id:        s.Id,
		Title:     s.Title,
		CreatedAt: s.CreatedAt,
		DoneAt:    s.DoneAt,
		DueDate:   s.DueDate,
		Done:      s.Done,
	}
}

type Category struct {
	Id        string `json:"cid"`
	Title     string `json:"title"`
	Secret    bool   `json:"secret"`
	Locked    bool   `json:"locked"`
	Color     string `json:"color"`
	CreatedAt int64  `json:"createdAt"`
}

func (c *Category) Copy() *Category {
	return &Category{
		Id:        c.Id,
		Title:     c.Title,
		Secret:    c.Secret,
		Locked:    c.Locked,
		Color:     c.Color,
		CreatedAt: c.CreatedAt,
	}
}
