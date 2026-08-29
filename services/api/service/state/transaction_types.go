package state

type TxInitializeBody struct {
	Tasks      map[string]Task     `json:"tasks"`
	Categories map[string]Category `json:"categories"`
}

type TxCreateTaskBody struct {
	Id            string          `json:"tid"`
	Title         string          `json:"title"`
	CreatedAt     int64           `json:"createdAt"`
	DoneAt        int64           `json:"doneAt"`
	Memo          string          `json:"memo"`
	Done          bool            `json:"done"`
	DueDate       int64           `json:"dueDate"`
	RepeatPeriod  string          `json:"repeatPeriod"`
	RepeatStartAt int64           `json:"repeatStartAt"`
	Categories    map[string]bool `json:"Categories"`
	PrevTaskId    string          `json:"prevTaskId"`
}

type TxDeleteTaskBody struct {
	Id string `json:"tid"`
}

type TxUpdateTaskOrderBody struct {
	Id           string `json:"tid"`
	TargetTaskId string `json:"targetTaskId"` // 기준 task id
	AfterTarget  bool   `json:"afterTarget"`  // 기준 task 다음에 추가할지 여부
}

type TxUpdateTaskTitleBody struct {
	Id    string `json:"tid"`
	Title string `json:"title"`
}

type TxUpdateTaskDueDateBody struct {
	Id      string `json:"tid"`
	DueDate int64  `json:"dueDate"`
}

type TxUpdateTaskMemoBody struct {
	Id   string `json:"tid"`
	Memo string `json:"memo"`
}

type TxUpdateTaskDoneBody struct {
	TaskId string `json:"tid"`
	Done   bool   `json:"done"`
	DoneAt int64  `json:"doneAt"`
}

type TxUpdateTaskRepeatPeriodBody struct {
	TaskId       string `json:"tid"`
	RepeatPeriod string `json:"repeatPeriod"`
}

type TxAddTaskCategoryBody struct {
	TaskId     string `json:"tid"`
	CategoryId string `json:"cid"`
}

type TxDeleteTaskCategoryBody struct {
	TaskId     string `json:"tid"`
	CategoryId string `json:"cid"`
}

type TxCreateSubtaskBody struct {
	TaskId    string `json:"tid"`
	SubtaskId string `json:"sid"`
	Title     string `json:"title"`
	CreatedAt int64  `json:"createdAt"`
	DueDate   int64  `json:"dueDate"`
	Done      bool   `json:"done"`
	DoneAt    int64  `json:"doneAt"`
}

type TxDeleteSubtaskBody struct {
	TaskId    string `json:"tid"`
	SubtaskId string `json:"sid"`
}

type TxUpdateSubtaskTitleBody struct {
	TaskId    string `json:"tid"`
	SubtaskId string `json:"sid"`
	Title     string `json:"title"`
}

type TxUpdateSubtaskDueDateBody struct {
	TaskId    string `json:"tid"`
	SubtaskId string `json:"sid"`
	DueDate   int64  `json:"dueDate"`
}

type TxUpdateSubtaskDoneBody struct {
	TaskId    string `json:"tid"`
	SubtaskId string `json:"sid"`
	Done      bool   `json:"done"`
	DoneAt    int64  `json:"doneAt"`
}

type TxCreateCategoryBody struct {
	Id        string `json:"cid"`
	Title     string `json:"title"`
	Secret    bool   `json:"secret"`
	Locked    bool   `json:"locked"`
	Color     string `json:"color"`
	CreatedAt int64  `json:"createdAt"`
}

type TxDeleteCategoryBody struct {
	Id string `json:"cid"`
}

type TxUpdateCategoryColorBody struct {
	Id    string `json:"cid"`
	Color string `json:"color"`
}
