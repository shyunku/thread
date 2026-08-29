package state

type CreateTaskParams struct {
	Id            string          `json:"tid"`
	Title         string          `json:"title"`
	CreatedAt     int64           `json:"createdAt"`
	DoneAt        int64           `json:"doneAt"`
	Memo          string          `json:"memo"`
	Done          bool            `json:"done"`
	DueDate       int64           `json:"dueDate"`
	RepeatPeriod  string          `json:"repeatPeriod"`
	RepeatStartAt int64           `json:"repeatStartAt"`
	Categories    map[string]bool `json:"categories"`
}

type DeleteTaskParams struct {
	Id string `json:"tid"`
}

type UpdateTaskNextParams struct {
	Id   string `json:"tid"`
	Next string `json:"next"`
}

type UpdateTaskTitleParams struct {
	Id    string `json:"tid"`
	Title string `json:"title"`
}

type UpdateTaskDueDateParams struct {
	Id      string `json:"tid"`
	DueDate int64  `json:"dueDate"`
}

type UpdateTaskMemoParams struct {
	Id   string `json:"tid"`
	Memo string `json:"memo"`
}

type UpdateTaskDoneParams struct {
	Id   string `json:"tid"`
	Done bool   `json:"done"`
}

type UpdateTaskDoneAtParams struct {
	Id     string `json:"tid"`
	DoneAt int64  `json:"doneAt"`
}

type UpdateTaskRepeatPeriodParams struct {
	Id           string `json:"tid"`
	RepeatPeriod string `json:"repeatPeriod"`
}

type UpdateTaskRepeatStartAtParams struct {
	Id            string `json:"tid"`
	RepeatStartAt int64  `json:"repeatStartAt"`
}

type CreateTaskCategoryParams struct {
	Id         string `json:"tid"`
	CategoryId string `json:"cid"`
}

type DeleteTaskCategoryParams struct {
	Id         string `json:"tid"`
	CategoryId string `json:"cid"`
}

type CreateSubtaskParams struct {
	Id        string `json:"tid"`
	SubtaskId string `json:"sid"`
	Title     string `json:"title"`
	CreatedAt int64  `json:"createdAt"`
	DueDate   int64  `json:"dueDate"`
	Done      bool   `json:"done"`
	DoneAt    int64  `json:"doneAt"`
}

type DeleteSubtaskParams struct {
	Id        string `json:"tid"`
	SubtaskId string `json:"sid"`
}

type UpdateSubtaskTitleParams struct {
	Id        string `json:"tid"`
	SubtaskId string `json:"sid"`
	Title     string `json:"title"`
}

type UpdateSubtaskDueDateParams struct {
	Id        string `json:"tid"`
	SubtaskId string `json:"sid"`
	DueDate   int64  `json:"dueDate"`
}

type UpdateSubtaskDoneParams struct {
	Id        string `json:"tid"`
	SubtaskId string `json:"sid"`
	Done      bool   `json:"done"`
}

type UpdateSubtaskDoneAtParams struct {
	Id        string `json:"tid"`
	SubtaskId string `json:"sid"`
	DoneAt    int64  `json:"doneAt"`
}

type CreateCategoryParams struct {
	Id        string `json:"cid"`
	Title     string `json:"title"`
	Secret    bool   `json:"secret"`
	Locked    bool   `json:"locked"`
	Color     string `json:"color"`
	CreatedAt int64  `json:"createdAt"`
}

type DeleteCategoryParams struct {
	Id string `json:"cid"`
}

type UpdateCategoryColorParams struct {
	Id    string `json:"cid"`
	Color string `json:"color"`
}
