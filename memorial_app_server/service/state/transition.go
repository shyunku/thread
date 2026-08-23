package state

import (
	"encoding/json"
	"errors"
	"fmt"
	"memorial_app_server/util"
)

var (
	ErrTaskNotFound     = errors.New("task not found")
	ErrSubtaskNotFound  = errors.New("subtask not found")
	ErrCategoryNotFound = errors.New("category not found")
)

const (
	OpDeleteAll               = 0   // 모든 데이터 삭제
	OpCreateTask              = 100 // 태스크 생성
	OpDeleteTask              = 101 // 태스크 삭제
	OpUpdateTaskNext          = 102 // 태스크 다음 순서 변경
	OpUpdateTaskTitle         = 103 // 태스크 제목 변경
	OpUpdateTaskDueDate       = 104 // 태스크 마감일 변경
	OpUpdateTaskMemo          = 105 // 태스크 메모 변경
	OpUpdateTaskDone          = 106 // 태스크 완료 여부 변경
	OpUpdateTaskDoneAt        = 107 // 태스크 완료 시간 변경
	OpUpdateTaskRepeatPeriod  = 108 // 태스크 반복 주기 변경
	OpUpdateTaskRepeatStartAt = 109 // 태스크 반복 시작 시간 변경

	OpCreateTaskCategory = 200 // 태스크 카테고리 추가
	OpDeleteTaskCategory = 201 // 태스크 카테고리 삭제

	OpCreateSubtask        = 300 // 서브태스크 생성
	OpDeleteSubtask        = 301 // 서브태스크 삭제
	OpUpdateSubtaskTitle   = 302 // 서브태스크 제목 변경
	OpUpdateSubtaskDueDate = 303 // 서브태스크 마감일 변경
	OpUpdateSubtaskDone    = 304 // 서브태스크 완료 여부 변경
	OpUpdateSubtaskDoneAt  = 305 // 서브태스크 완료 시간 변경

	OpCreateCategory      = 400 // 카테고리 생성
	OpDeleteCategory      = 401 // 카테고리 삭제
	OpUpdateCategoryColor = 402 // 카테고리 색상 변경
)

type Transitions []Transition

func NewTransitions() Transitions {
	return make([]Transition, 0)
}

func (t *Transitions) FromBytes(b []byte) error {
	// unmarshal state
	if err := json.Unmarshal(b, t); err != nil {
		return err
	}
	return nil
}

func (t *Transitions) ToBytes() ([]byte, error) {
	// marshal state
	bytes, err := json.Marshal(t)
	if err != nil {
		return nil, err
	}
	return bytes, nil
}

type Updates struct {
	SrcTx       *Transaction `json:"srcTx"`
	Transitions Transitions  `json:"transitions"`
}

func NewUpdates(srcTx *Transaction) *Updates {
	return &Updates{
		SrcTx:       srcTx,
		Transitions: make([]Transition, 0),
	}
}

func NewUpdatesWithTransitions(srcTx *Transaction, transitions Transitions) *Updates {
	return &Updates{
		SrcTx:       srcTx,
		Transitions: transitions,
	}
}

func (u *Updates) add(operation int64, params interface{}) {
	u.Transitions = append(u.Transitions, Transition{
		Operation: operation,
		Params:    params,
	})
}

func (u *Updates) ApplyTransitions(prevState *State) (*State, error) {
	newState := prevState.Copy()
	for _, transition := range u.Transitions {
		var err error
		newState, err = transition.ExecuteTransition(newState)
		if err != nil {
			return nil, err
		}
	}
	return newState, nil
}

type Transition struct {
	Operation int64       `json:"operation"`
	Params    interface{} `json:"params"`
}

func (t *Transition) ExecuteTransition(original *State) (*State, error) {
	state := original.Copy()
	switch t.Operation {
	case OpDeleteAll:
		return t.DeleteAll(state, t.Params)
	case OpCreateTask:
		return t.CreateTask(state, t.Params)
	case OpDeleteTask:
		return t.DeleteTask(state, t.Params)
	case OpUpdateTaskNext:
		return t.UpdateTaskNext(state, t.Params)
	case OpUpdateTaskTitle:
		return t.UpdateTaskTitle(state, t.Params)
	case OpUpdateTaskDueDate:
		return t.UpdateTaskDueDate(state, t.Params)
	case OpUpdateTaskMemo:
		return t.UpdateTaskMemo(state, t.Params)
	case OpUpdateTaskDone:
		return t.UpdateTaskDone(state, t.Params)
	case OpUpdateTaskDoneAt:
		return t.UpdateTaskDoneAt(state, t.Params)
	case OpUpdateTaskRepeatPeriod:
		return t.UpdateTaskRepeatPeriod(state, t.Params)
	case OpUpdateTaskRepeatStartAt:
		return t.UpdateTaskRepeatStartAt(state, t.Params)
	case OpCreateTaskCategory:
		return t.CreateTaskCategory(state, t.Params)
	case OpDeleteTaskCategory:
		return t.DeleteTaskCategory(state, t.Params)
	case OpCreateSubtask:
		return t.CreateSubtask(state, t.Params)
	case OpDeleteSubtask:
		return t.DeleteSubtask(state, t.Params)
	case OpUpdateSubtaskTitle:
		return t.UpdateSubtaskTitle(state, t.Params)
	case OpUpdateSubtaskDueDate:
		return t.UpdateSubtaskDueDate(state, t.Params)
	case OpUpdateSubtaskDone:
		return t.UpdateSubtaskDone(state, t.Params)
	case OpUpdateSubtaskDoneAt:
		return t.UpdateSubtaskDoneAt(state, t.Params)
	case OpCreateCategory:
		return t.CreateCategory(state, t.Params)
	case OpDeleteCategory:
		return t.DeleteCategory(state, t.Params)
	case OpUpdateCategoryColor:
		return t.UpdateCategoryColor(state, t.Params)
	default:
		return nil, fmt.Errorf("unknown operation: %d", t.Operation)
	}
}

func (t *Transition) DeleteAll(state *State, params interface{}) (*State, error) {
	state.Tasks = map[string]Task{}
	state.Categories = map[string]Category{}
	return state, nil
}

func (t *Transition) CreateTask(state *State, params interface{}) (*State, error) {
	var data CreateTaskParams
	if err := util.InterfaceToStruct(params, &data); err != nil {
		return nil, err
	}

	state.Tasks[data.Id] = Task{
		Id:            data.Id,
		Title:         data.Title,
		CreatedAt:     data.CreatedAt,
		DoneAt:        data.DoneAt,
		Memo:          data.Memo,
		Done:          data.Done,
		DueDate:       data.DueDate,
		RepeatPeriod:  data.RepeatPeriod,
		RepeatStartAt: data.RepeatStartAt,
		Subtasks:      map[string]Subtask{},
		Categories:    data.Categories,
	}

	return state, nil
}

func (t *Transition) DeleteTask(state *State, params interface{}) (*State, error) {
	var data DeleteTaskParams
	if err := util.InterfaceToStruct(params, &data); err != nil {
		return nil, err
	}

	delete(state.Tasks, data.Id)
	return state, nil
}

func (t *Transition) UpdateTaskNext(state *State, params interface{}) (*State, error) {
	var data UpdateTaskNextParams
	if err := util.InterfaceToStruct(params, &data); err != nil {
		return nil, err
	}

	task, ok := state.Tasks[data.Id]
	if !ok {
		return nil, ErrTaskNotFound
	}

	task.Next = data.Next
	state.Tasks[data.Id] = task
	return state, nil
}

func (t *Transition) UpdateTaskTitle(state *State, params interface{}) (*State, error) {
	var data UpdateTaskTitleParams
	if err := util.InterfaceToStruct(params, &data); err != nil {
		return nil, err
	}

	task, ok := state.Tasks[data.Id]
	if !ok {
		return nil, ErrTaskNotFound
	}

	task.Title = data.Title
	state.Tasks[data.Id] = task
	return state, nil
}

func (t *Transition) UpdateTaskDueDate(state *State, params interface{}) (*State, error) {
	var data UpdateTaskDueDateParams
	if err := util.InterfaceToStruct(params, &data); err != nil {
		return nil, err
	}

	task, ok := state.Tasks[data.Id]
	if !ok {
		return nil, ErrTaskNotFound
	}

	task.DueDate = data.DueDate
	state.Tasks[data.Id] = task
	return state, nil
}

func (t *Transition) UpdateTaskMemo(state *State, params interface{}) (*State, error) {
	var data UpdateTaskMemoParams
	if err := util.InterfaceToStruct(params, &data); err != nil {
		return nil, err
	}

	task, ok := state.Tasks[data.Id]
	if !ok {
		return nil, ErrTaskNotFound
	}

	task.Memo = data.Memo
	state.Tasks[data.Id] = task
	return state, nil
}

func (t *Transition) UpdateTaskDone(state *State, params interface{}) (*State, error) {
	var data UpdateTaskDoneParams
	if err := util.InterfaceToStruct(params, &data); err != nil {
		return nil, err
	}

	task, ok := state.Tasks[data.Id]
	if !ok {
		return nil, ErrTaskNotFound
	}

	task.Done = data.Done
	state.Tasks[data.Id] = task
	return state, nil
}

func (t *Transition) UpdateTaskDoneAt(state *State, params interface{}) (*State, error) {
	var data UpdateTaskDoneAtParams
	if err := util.InterfaceToStruct(params, &data); err != nil {
		return nil, err
	}

	task, ok := state.Tasks[data.Id]
	if !ok {
		return nil, ErrTaskNotFound
	}

	task.DoneAt = data.DoneAt
	state.Tasks[data.Id] = task
	return state, nil
}

func (t *Transition) UpdateTaskRepeatPeriod(state *State, params interface{}) (*State, error) {
	var data UpdateTaskRepeatPeriodParams
	if err := util.InterfaceToStruct(params, &data); err != nil {
		return nil, err
	}

	task, ok := state.Tasks[data.Id]
	if !ok {
		return nil, ErrTaskNotFound
	}

	task.RepeatPeriod = data.RepeatPeriod
	state.Tasks[data.Id] = task
	return state, nil
}

func (t *Transition) UpdateTaskRepeatStartAt(state *State, params interface{}) (*State, error) {
	var data UpdateTaskRepeatStartAtParams
	if err := util.InterfaceToStruct(params, &data); err != nil {
		return nil, err
	}

	task, ok := state.Tasks[data.Id]
	if !ok {
		return nil, ErrTaskNotFound
	}

	task.RepeatStartAt = data.RepeatStartAt
	state.Tasks[data.Id] = task
	return state, nil
}

func (t *Transition) CreateTaskCategory(state *State, params interface{}) (*State, error) {
	var data CreateTaskCategoryParams
	if err := util.InterfaceToStruct(params, &data); err != nil {
		return nil, err
	}

	task, ok := state.Tasks[data.Id]
	if !ok {
		return nil, ErrTaskNotFound
	}

	task.Categories[data.CategoryId] = true
	state.Tasks[data.Id] = task
	return state, nil
}

func (t *Transition) DeleteTaskCategory(state *State, params interface{}) (*State, error) {
	var data DeleteTaskCategoryParams
	if err := util.InterfaceToStruct(params, &data); err != nil {
		return nil, err
	}

	task, ok := state.Tasks[data.Id]
	if !ok {
		return nil, ErrTaskNotFound
	}

	delete(task.Categories, data.CategoryId)
	state.Tasks[data.Id] = task
	return state, nil
}

func (t *Transition) CreateSubtask(state *State, params interface{}) (*State, error) {
	var data CreateSubtaskParams
	if err := util.InterfaceToStruct(params, &data); err != nil {
		return nil, err
	}

	task, ok := state.Tasks[data.Id]
	if !ok {
		return nil, ErrTaskNotFound
	}

	task.Subtasks[data.SubtaskId] = Subtask{
		Id:        data.SubtaskId,
		Title:     data.Title,
		CreatedAt: data.CreatedAt,
		DueDate:   data.DueDate,
		Done:      data.Done,
		DoneAt:    data.DoneAt,
	}
	state.Tasks[data.Id] = task
	return state, nil
}

func (t *Transition) DeleteSubtask(state *State, params interface{}) (*State, error) {
	var data DeleteSubtaskParams
	if err := util.InterfaceToStruct(params, &data); err != nil {
		return nil, err
	}

	task, ok := state.Tasks[data.Id]
	if !ok {
		return nil, ErrTaskNotFound
	}

	delete(task.Subtasks, data.SubtaskId)
	state.Tasks[data.Id] = task
	return state, nil
}

func (t *Transition) UpdateSubtaskTitle(state *State, params interface{}) (*State, error) {
	var data UpdateSubtaskTitleParams
	if err := util.InterfaceToStruct(params, &data); err != nil {
		return nil, err
	}

	subtask, ok := state.Tasks[data.Id].Subtasks[data.SubtaskId]
	if !ok {
		return nil, ErrSubtaskNotFound
	}

	subtask.Title = data.Title
	state.Tasks[data.Id].Subtasks[data.SubtaskId] = subtask
	return state, nil
}

func (t *Transition) UpdateSubtaskDueDate(state *State, params interface{}) (*State, error) {
	var data UpdateSubtaskDueDateParams
	if err := util.InterfaceToStruct(params, &data); err != nil {
		return nil, err
	}

	subtask, ok := state.Tasks[data.Id].Subtasks[data.SubtaskId]
	if !ok {
		return nil, ErrSubtaskNotFound
	}

	subtask.DueDate = data.DueDate
	state.Tasks[data.Id].Subtasks[data.SubtaskId] = subtask
	return state, nil
}

func (t *Transition) UpdateSubtaskDone(state *State, params interface{}) (*State, error) {
	var data UpdateSubtaskDoneParams
	if err := util.InterfaceToStruct(params, &data); err != nil {
		return nil, err
	}

	subtask, ok := state.Tasks[data.Id].Subtasks[data.SubtaskId]
	if !ok {
		return nil, ErrSubtaskNotFound
	}

	subtask.Done = data.Done
	state.Tasks[data.Id].Subtasks[data.SubtaskId] = subtask
	return state, nil
}

func (t *Transition) UpdateSubtaskDoneAt(state *State, params interface{}) (*State, error) {
	var data UpdateSubtaskDoneAtParams
	if err := util.InterfaceToStruct(params, &data); err != nil {
		return nil, err
	}

	subtask, ok := state.Tasks[data.Id].Subtasks[data.SubtaskId]
	if !ok {
		return nil, ErrSubtaskNotFound
	}

	subtask.DoneAt = data.DoneAt
	state.Tasks[data.Id].Subtasks[data.SubtaskId] = subtask
	return state, nil
}

func (t *Transition) CreateCategory(state *State, params interface{}) (*State, error) {
	var data CreateCategoryParams
	if err := util.InterfaceToStruct(params, &data); err != nil {
		return nil, err
	}

	state.Categories[data.Id] = Category{
		Id:        data.Id,
		Title:     data.Title,
		Secret:    data.Secret,
		Locked:    data.Locked,
		Color:     data.Color,
		CreatedAt: data.CreatedAt,
	}
	return state, nil
}

func (t *Transition) DeleteCategory(state *State, params interface{}) (*State, error) {
	var data DeleteCategoryParams
	if err := util.InterfaceToStruct(params, &data); err != nil {
		return nil, err
	}

	delete(state.Categories, data.Id)
	return state, nil
}

func (t *Transition) UpdateCategoryColor(state *State, params interface{}) (*State, error) {
	var data UpdateCategoryColorParams
	if err := util.InterfaceToStruct(params, &data); err != nil {
		return nil, err
	}

	category, ok := state.Categories[data.Id]
	if !ok {
		return nil, ErrCategoryNotFound
	}

	category.Color = data.Color
	state.Categories[data.Id] = category
	return state, nil
}
