package state

import (
	"fmt"
	"memorial_app_server/log"
	"memorial_app_server/util"
	"time"
)

const (
	TxInitialize = 0

	TxCreateTask             = 10000
	TxDeleteTask             = 10001
	TxUpdateTaskOrder        = 10002
	TxUpdateTaskTitle        = 10003
	TxUpdateTaskDueDate      = 10004
	TxUpdateTaskMemo         = 10005
	TxUpdateTaskDone         = 10006
	TxUpdateTaskRepeatPeriod = 10007

	TxAddTaskCategory    = 10100
	TxDeleteTaskCategory = 10101

	TxCreateSubtask        = 11000
	TxDeleteSubtask        = 11001
	TxUpdateSubtaskTitle   = 11002
	TxUpdateSubtaskDueDate = 11003
	TxUpdateSubtaskDone    = 11004

	TxCreateCategory      = 12000
	TxDeleteCategory      = 12001
	TxUpdateCategoryColor = 12002
)

func PreExecuteTransaction(prevState *State, tx *Transaction, newBlockNumber int64) (*Updates, error) {
	state := prevState.Copy()

	switch tx.Type {
	case TxInitialize:
		return InitializeState(state, tx, newBlockNumber)
	case TxCreateTask:
		return CreateTask(state, tx)
	case TxDeleteTask:
		return DeleteTask(state, tx)
	case TxUpdateTaskOrder:
		return UpdateTaskOrder(state, tx)
	case TxUpdateTaskTitle:
		return UpdateTaskTitle(state, tx)
	case TxUpdateTaskDueDate:
		return UpdateTaskDueDate(state, tx)
	case TxUpdateTaskMemo:
		return UpdateTaskMemo(state, tx)
	case TxUpdateTaskDone:
		return UpdateTaskDone(state, tx)
	case TxUpdateTaskRepeatPeriod:
		return UpdateTaskRepeatPeriod(state, tx)
	case TxAddTaskCategory:
		return AddTaskCategory(state, tx)
	case TxDeleteTaskCategory:
		return DeleteTaskCategory(state, tx)
	case TxCreateSubtask:
		return CreateSubtask(state, tx)
	case TxDeleteSubtask:
		return DeleteSubtask(state, tx)
	case TxUpdateSubtaskTitle:
		return UpdateSubtaskTitle(state, tx)
	case TxUpdateSubtaskDueDate:
		return UpdateSubtaskDueDate(state, tx)
	case TxUpdateSubtaskDone:
		return UpdateSubtaskDone(state, tx)
	case TxCreateCategory:
		return CreateCategory(state, tx)
	case TxDeleteCategory:
		return DeleteCategory(state, tx)
	case TxUpdateCategoryColor:
		return UpdateCategoryColor(state, tx)
	default:
		return nil, ErrInvalidTxType
	}
}

func InitializeState(prevState *State, tx *Transaction, newBlockNumber int64) (*Updates, error) {
	updates := NewUpdates(tx)

	var body TxInitializeBody
	if err := util.InterfaceToStruct(tx.Content, &body); err != nil {
		return nil, err
	}

	// delete all data from old state
	updates.add(OpDeleteAll, nil)

	for _, category := range body.Categories {
		updates.add(OpCreateCategory, &CreateCategoryParams{
			Id:        category.Id,
			Title:     category.Title,
			Secret:    category.Secret,
			Locked:    category.Locked,
			Color:     category.Color,
			CreatedAt: category.CreatedAt,
		})
	}

	for _, task := range body.Tasks {
		categories := make(map[string]bool)
		for categoryId := range task.Categories {
			categories[categoryId] = true
		}

		updates.add(OpCreateTask, &CreateTaskParams{
			Id:            task.Id,
			Title:         task.Title,
			CreatedAt:     task.CreatedAt,
			DoneAt:        task.DoneAt,
			Memo:          task.Memo,
			Done:          task.Done,
			DueDate:       task.DueDate,
			RepeatPeriod:  task.RepeatPeriod,
			RepeatStartAt: task.RepeatStartAt,
			Categories:    categories,
		})

		updates.add(OpUpdateTaskNext, &UpdateTaskNextParams{
			Id:   task.Id,
			Next: task.Next,
		})

		for _, subtask := range task.Subtasks {
			updates.add(OpCreateSubtask, &CreateSubtaskParams{
				Id:        task.Id,
				SubtaskId: subtask.Id,
				Title:     subtask.Title,
				CreatedAt: subtask.CreatedAt,
				DueDate:   subtask.DueDate,
				Done:      subtask.Done,
				DoneAt:    subtask.DoneAt,
			})
		}
	}

	return updates, nil
}

func CreateTask(state *State, tx *Transaction) (*Updates, error) {
	updates := NewUpdates(tx)
	var body TxCreateTaskBody
	if err := util.InterfaceToStruct(tx.Content, &body); err != nil {
		return nil, err
	}

	categories := make(map[string]bool)
	for categoryId := range body.Categories {
		if _, ok := state.Categories[categoryId]; !ok {
			return nil, fmt.Errorf("category not found: %s", categoryId)
		}
		categories[categoryId] = true
	}

	updates.add(OpCreateTask, &CreateTaskParams{
		Id:            body.Id,
		Title:         body.Title,
		CreatedAt:     body.CreatedAt,
		DoneAt:        body.DoneAt,
		Memo:          body.Memo,
		Done:          body.Done,
		DueDate:       body.DueDate,
		RepeatPeriod:  body.RepeatPeriod,
		RepeatStartAt: body.RepeatStartAt,
		Categories:    categories,
	})

	// update next of previous
	if body.PrevTaskId != "" {
		prevTask := state.Tasks[body.PrevTaskId]
		updates.add(OpUpdateTaskNext, &UpdateTaskNextParams{
			Id:   prevTask.Id,
			Next: body.Id,
		})
	}

	return updates, nil
}

func DeleteTask(state *State, tx *Transaction) (*Updates, error) {
	updates := NewUpdates(tx)
	var body TxDeleteTaskBody
	if err := util.InterfaceToStruct(tx.Content, &body); err != nil {
		return nil, err
	}

	sortedTasks, err := state.SortTasks()
	if err != nil {
		return nil, err
	}

	dt, ok := sortedTasks[body.Id]
	if !ok {
		return nil, ErrTaskNotFound
	}

	updates.add(OpDeleteTask, &DeleteTaskParams{
		Id: body.Id,
	})

	// update next of previous
	if dt.Prev != "" {
		prevTask, ok := state.Tasks[dt.Prev]
		if !ok {
			return nil, fmt.Errorf("prev task not found: %s", dt.Prev)
		}

		if prevTask.Next != body.Id {
			log.Warnf("prevTask.Next(%s) != body.Id(%s)", prevTask.Next, body.Id)
			return nil, ErrStateMismatch
		}

		updates.add(OpUpdateTaskNext, &UpdateTaskNextParams{
			Id:   prevTask.Id,
			Next: state.Tasks[body.Id].Next,
		})

		log.Debug("prevTask.Id: ", prevTask.Id)
	}

	return updates, nil
}

func UpdateTaskOrder(state *State, tx *Transaction) (*Updates, error) {
	updates := NewUpdates(tx)
	var body TxUpdateTaskOrderBody
	if err := util.InterfaceToStruct(tx.Content, &body); err != nil {
		return nil, err
	}

	currentTask, ok := state.Tasks[body.Id]
	if !ok {
		log.Warnf("updating order task(%s) not found", body.Id)
		return nil, ErrStateMismatch
	}

	sortedTasks, err := state.SortTasks()
	if err != nil {
		return nil, err
	}

	dt, ok := sortedTasks[body.Id]
	if !ok {
		return nil, ErrTaskNotFound
	}

	// get next Task
	nextTaskId := currentTask.Next

	// update previous task's next
	if dt.Prev != "" {
		prevTask, ok := state.Tasks[dt.Prev]
		if !ok {
			return nil, fmt.Errorf("prev task not found: %s", dt.Prev)
		}

		if prevTask.Next != body.Id {
			log.Warnf("prevTask.Next(%s) != body.Id(%s)", prevTask.Next, body.Id)
			return nil, ErrStateMismatch
		}

		prevTask.Next = nextTaskId
		updates.add(OpUpdateTaskNext, &UpdateTaskNextParams{
			Id:   prevTask.Id,
			Next: nextTaskId,
		})
		state.Tasks[dt.Prev] = prevTask
	}

	targetTask, targetTaskExists := state.Tasks[body.TargetTaskId]

	if body.AfterTarget {
		var targetTaskNextId string
		// update target task's next
		if targetTaskExists {
			targetTaskNextId = targetTask.Next
			targetTask.Next = body.Id
			updates.add(OpUpdateTaskNext, &UpdateTaskNextParams{
				Id:   targetTask.Id,
				Next: body.Id,
			})
			state.Tasks[targetTask.Id] = targetTask
		} else {
			targetTaskNextId = ""
		}
		// update task's next
		currentTask.Next = targetTaskNextId
		updates.add(OpUpdateTaskNext, &UpdateTaskNextParams{
			Id:   currentTask.Id,
			Next: targetTaskNextId,
		})
		state.Tasks[currentTask.Id] = currentTask
	} else {
		targetDt, ok := sortedTasks[targetTask.Id]
		if !ok {
			return nil, ErrTaskNotFound
		}

		// update target prev task's next
		if targetDt.Prev != "" {
			targetPrevTask, ok := state.Tasks[targetDt.Prev]
			if !ok {
				log.Warnf("updating order targetPrevTask(%s) not found", targetDt.Prev)
				return nil, ErrStateMismatch
			}
			if targetPrevTask.Next != body.TargetTaskId {
				log.Warnf("targetPrevTask.Next(%s) != body.TargetTaskId(%s)", targetPrevTask.Next, body.TargetTaskId)
				return nil, ErrStateMismatch
			}
			targetPrevTask.Next = body.Id
			updates.add(OpUpdateTaskNext, &UpdateTaskNextParams{
				Id:   targetPrevTask.Id,
				Next: body.Id,
			})
			state.Tasks[targetPrevTask.Id] = targetPrevTask
		}
		// update task's next
		currentTask.Next = body.TargetTaskId
		updates.add(OpUpdateTaskNext, &UpdateTaskNextParams{
			Id:   currentTask.Id,
			Next: body.TargetTaskId,
		})
		state.Tasks[currentTask.Id] = currentTask
	}

	return updates, nil
}

func UpdateTaskTitle(state *State, tx *Transaction) (*Updates, error) {
	updates := NewUpdates(tx)
	var body TxUpdateTaskTitleBody
	if err := util.InterfaceToStruct(tx.Content, &body); err != nil {
		return nil, err
	}

	_, ok := state.Tasks[body.Id]
	if !ok {
		log.Warnf("updating title task(%s) not found", body.Id)
		return nil, ErrStateMismatch
	}

	updates.add(OpUpdateTaskTitle, &UpdateTaskTitleParams{
		Id:    body.Id,
		Title: body.Title,
	})
	return updates, nil
}

func UpdateTaskDueDate(state *State, tx *Transaction) (*Updates, error) {
	updates := NewUpdates(tx)
	var body TxUpdateTaskDueDateBody
	if err := util.InterfaceToStruct(tx.Content, &body); err != nil {
		return nil, err
	}

	task, ok := state.Tasks[body.Id]
	if !ok {
		log.Warnf("updating dueDate task(%s) not found", body.Id)
		return nil, ErrStateMismatch
	}

	// if repeat period exists, update repeat start at to due date (to update)
	if task.RepeatPeriod != "" {
		updates.add(OpUpdateTaskRepeatStartAt, &UpdateTaskRepeatStartAtParams{
			Id:            body.Id,
			RepeatStartAt: body.DueDate,
		})
	}

	updates.add(OpUpdateTaskDueDate, &UpdateTaskDueDateParams{
		Id:      body.Id,
		DueDate: body.DueDate,
	})
	return updates, nil
}

func UpdateTaskMemo(state *State, tx *Transaction) (*Updates, error) {
	updates := NewUpdates(tx)
	var body TxUpdateTaskMemoBody
	if err := util.InterfaceToStruct(tx.Content, &body); err != nil {
		return nil, err
	}

	_, ok := state.Tasks[body.Id]
	if !ok {
		log.Warnf("updating memo task(%s) not found", body.Id)
		return nil, ErrStateMismatch
	}

	updates.add(OpUpdateTaskMemo, &UpdateTaskMemoParams{
		Id:   body.Id,
		Memo: body.Memo,
	})
	return updates, nil
}

func UpdateTaskDone(state *State, tx *Transaction) (*Updates, error) {
	updates := NewUpdates(tx)
	var body TxUpdateTaskDoneBody
	if err := util.InterfaceToStruct(tx.Content, &body); err != nil {
		return nil, err
	}

	task, ok := state.Tasks[body.TaskId]
	if !ok {
		log.Warnf("updating done task(%s) not found", body.TaskId)
		return nil, ErrStateMismatch
	}

	if task.RepeatPeriod != "" {
		// create clone of this task with done and save
		// with repeat deletion
		doneTask := task.CopyNew()
		updates.add(OpCreateTask, &CreateTaskParams{
			Id:            doneTask.Id,
			Title:         doneTask.Title,
			CreatedAt:     doneTask.CreatedAt,
			DoneAt:        doneTask.DoneAt,
			Memo:          doneTask.Memo,
			Done:          true,
			DueDate:       doneTask.DueDate,
			RepeatPeriod:  "",
			RepeatStartAt: 0,
			Categories:    doneTask.Categories,
		})

		// update task order
		bidirectionalTasks, err := state.SortTasks()
		if err != nil {
			return nil, err
		}

		prevTaskId := bidirectionalTasks[task.Id].Prev

		// set new task order
		if prevTaskId != "" {
			updates.add(OpUpdateTaskNext, &UpdateTaskNextParams{
				Id:   prevTaskId,
				Next: doneTask.Id,
			})
		}
		updates.add(OpUpdateTaskNext, &UpdateTaskNextParams{
			Id:   doneTask.Id,
			Next: task.Id,
		})

		repeatStartAt := task.RepeatStartAt
		if repeatStartAt == 0 {
			repeatStartAt = task.DueDate
		}
		repeatPeriod := task.RepeatPeriod
		// date milli (int64) -> time
		nextDueDate := time.Unix(0, repeatStartAt*int64(time.Millisecond))
		// compare with milliseconds
		for nextDueDate.Before(time.Now()) || nextDueDate.UnixNano()/int64(time.Millisecond) <= task.DueDate {
			switch repeatPeriod {
			case "day":
				nextDueDate = nextDueDate.AddDate(0, 0, 1)
			case "week":
				nextDueDate = nextDueDate.AddDate(0, 0, 7)
			case "month":
				nextDueDate = nextDueDate.AddDate(0, 1, 0)
			case "year":
				nextDueDate = nextDueDate.AddDate(1, 0, 0)
			}
		}

		updates.add(OpUpdateTaskDone, &UpdateTaskDoneParams{
			Id:   body.TaskId,
			Done: false,
		})
		updates.add(OpUpdateTaskDoneAt, &UpdateTaskDoneAtParams{
			Id:     body.TaskId,
			DoneAt: body.DoneAt,
		})
		updates.add(OpUpdateTaskDueDate, &UpdateTaskDueDateParams{
			Id:      body.TaskId,
			DueDate: nextDueDate.UnixMilli(),
		})

		// calculate difference between task due date and next due date
		dueDateTime := time.UnixMilli(task.DueDate)
		diffTime := nextDueDate.Sub(dueDateTime)

		// update subtasks done & due date
		for sid, subtask := range task.Subtasks {
			// set done as false
			updates.add(OpUpdateSubtaskDone, &UpdateSubtaskDoneParams{
				Id:        body.TaskId,
				SubtaskId: sid,
				Done:      false,
			})
			updates.add(OpUpdateSubtaskDoneAt, &UpdateSubtaskDoneAtParams{
				Id:        body.TaskId,
				SubtaskId: sid,
				DoneAt:    0,
			})

			// update subtasks due date
			subtaskDueDate := subtask.DueDate
			if subtaskDueDate != 0 {
				subtaskDueDateTime := time.UnixMilli(subtaskDueDate)
				newSubtaskDueDateTime := subtaskDueDateTime.Add(diffTime)
				updates.add(OpUpdateSubtaskDueDate, &UpdateSubtaskDueDateParams{
					Id:        body.TaskId,
					SubtaskId: sid,
					DueDate:   newSubtaskDueDateTime.UnixMilli(),
				})
			}
		}
	} else {
		updates.add(OpUpdateTaskDone, &UpdateTaskDoneParams{
			Id:   body.TaskId,
			Done: body.Done,
		})
		updates.add(OpUpdateTaskDoneAt, &UpdateTaskDoneAtParams{
			Id:     body.TaskId,
			DoneAt: body.DoneAt,
		})
	}

	return updates, nil
}

func UpdateTaskRepeatPeriod(state *State, tx *Transaction) (*Updates, error) {
	updates := NewUpdates(tx)
	var body TxUpdateTaskRepeatPeriodBody
	if err := util.InterfaceToStruct(tx.Content, &body); err != nil {
		return nil, err
	}

	task, ok := state.Tasks[body.TaskId]
	if !ok {
		log.Warnf("updating repeatPeriod task(%s) not found", body.TaskId)
		return nil, ErrStateMismatch
	}

	updates.add(OpUpdateTaskRepeatPeriod, &UpdateTaskRepeatPeriodParams{
		Id:           body.TaskId,
		RepeatPeriod: body.RepeatPeriod,
	})
	task.RepeatPeriod = body.RepeatPeriod
	// update repeat period start time
	repeatStartAt := task.RepeatStartAt
	if repeatStartAt == 0 {
		// if start at is not set, set to due date if possible
		repeatStartAt = task.DueDate
		if repeatStartAt != 0 {
			task.RepeatStartAt = repeatStartAt
			updates.add(OpUpdateTaskRepeatStartAt, &UpdateTaskRepeatStartAtParams{
				Id:            body.TaskId,
				RepeatStartAt: repeatStartAt,
			})
		}
	}

	return updates, nil
}

func AddTaskCategory(state *State, tx *Transaction) (*Updates, error) {
	updates := NewUpdates(tx)
	var body TxAddTaskCategoryBody
	if err := util.InterfaceToStruct(tx.Content, &body); err != nil {
		return nil, err
	}

	_, ok := state.Tasks[body.TaskId]
	if !ok {
		log.Warnf("adding category task(%s) not found", body.TaskId)
		return nil, ErrStateMismatch
	}

	_, ok = state.Categories[body.CategoryId]
	if !ok {
		log.Warnf("adding category category(%s) not found", body.CategoryId)
		return nil, ErrStateMismatch
	}

	updates.add(OpCreateTaskCategory, &CreateTaskCategoryParams{
		Id:         body.TaskId,
		CategoryId: body.CategoryId,
	})
	return updates, nil
}

func DeleteTaskCategory(state *State, tx *Transaction) (*Updates, error) {
	updates := NewUpdates(tx)
	var body TxDeleteTaskCategoryBody
	if err := util.InterfaceToStruct(tx.Content, &body); err != nil {
		return nil, err
	}

	task, ok := state.Tasks[body.TaskId]
	if !ok {
		log.Warnf("deleting category task(%s) not found", body.TaskId)
		return nil, ErrStateMismatch
	}

	_, ok = task.Categories[body.CategoryId]
	if !ok {
		log.Warnf("deleting category category(%s) not found", body.CategoryId)
		return nil, ErrStateMismatch
	}

	updates.add(OpDeleteTaskCategory, &DeleteTaskCategoryParams{
		Id:         body.TaskId,
		CategoryId: body.CategoryId,
	})
	return updates, nil
}

func CreateSubtask(state *State, tx *Transaction) (*Updates, error) {
	updates := NewUpdates(tx)
	var body TxCreateSubtaskBody
	if err := util.InterfaceToStruct(tx.Content, &body); err != nil {
		return nil, err
	}

	_, ok := state.Tasks[body.TaskId]
	if !ok {
		log.Warnf("adding subtask task(%s) not found", body.TaskId)
		return nil, ErrStateMismatch
	}

	updates.add(OpCreateSubtask, &CreateSubtaskParams{
		Id:        body.TaskId,
		SubtaskId: body.SubtaskId,
		Title:     body.Title,
		CreatedAt: body.CreatedAt,
		DueDate:   body.DueDate,
		Done:      body.Done,
		DoneAt:    body.DoneAt,
	})
	return updates, nil
}

func DeleteSubtask(state *State, tx *Transaction) (*Updates, error) {
	updates := NewUpdates(tx)
	var body TxDeleteSubtaskBody
	if err := util.InterfaceToStruct(tx.Content, &body); err != nil {
		return nil, err
	}

	task, ok := state.Tasks[body.TaskId]
	if !ok {
		log.Warnf("deleting subtask task(%s) not found", body.TaskId)
		return nil, ErrStateMismatch
	}

	_, ok = task.Subtasks[body.SubtaskId]
	if !ok {
		log.Warnf("deleting subtask subtask(%s) not found", body.SubtaskId)
		return nil, ErrStateMismatch
	}

	updates.add(OpDeleteSubtask, &DeleteSubtaskParams{
		Id:        body.TaskId,
		SubtaskId: body.SubtaskId,
	})
	return updates, nil
}

func UpdateSubtaskTitle(state *State, tx *Transaction) (*Updates, error) {
	updates := NewUpdates(tx)
	var body TxUpdateSubtaskTitleBody
	if err := util.InterfaceToStruct(tx.Content, &body); err != nil {
		return nil, err
	}

	task, ok := state.Tasks[body.TaskId]
	if !ok {
		log.Warnf("updating subtask title task(%s) not found", body.TaskId)
		return nil, ErrStateMismatch
	}

	_, ok = task.Subtasks[body.SubtaskId]
	if !ok {
		log.Warnf("updating subtask title subtask(%s) not found", body.SubtaskId)
		return nil, ErrStateMismatch
	}

	updates.add(OpUpdateSubtaskTitle, &UpdateSubtaskTitleParams{
		Id:        body.TaskId,
		SubtaskId: body.SubtaskId,
		Title:     body.Title,
	})
	return updates, nil
}

func UpdateSubtaskDueDate(state *State, tx *Transaction) (*Updates, error) {
	updates := NewUpdates(tx)
	var body TxUpdateSubtaskDueDateBody
	if err := util.InterfaceToStruct(tx.Content, &body); err != nil {
		return nil, err
	}

	task, ok := state.Tasks[body.TaskId]
	if !ok {
		log.Warnf("updating subtask dueDate task(%s) not found", body.TaskId)
		return nil, ErrStateMismatch
	}

	_, ok = task.Subtasks[body.SubtaskId]
	if !ok {
		log.Warnf("updating subtask dueDate subtask(%s) not found", body.SubtaskId)
		return nil, ErrStateMismatch
	}

	updates.add(OpUpdateSubtaskDueDate, &UpdateSubtaskDueDateParams{
		Id:        body.TaskId,
		SubtaskId: body.SubtaskId,
		DueDate:   body.DueDate,
	})
	return updates, nil
}

func UpdateSubtaskDone(state *State, tx *Transaction) (*Updates, error) {
	updates := NewUpdates(tx)
	var body TxUpdateSubtaskDoneBody
	if err := util.InterfaceToStruct(tx.Content, &body); err != nil {
		return nil, err
	}

	task, ok := state.Tasks[body.TaskId]
	if !ok {
		log.Warnf("updating subtask done task(%s) not found", body.TaskId)
		return nil, ErrStateMismatch
	}

	_, ok = task.Subtasks[body.SubtaskId]
	if !ok {
		log.Warnf("updating subtask done subtask(%s) not found", body.SubtaskId)
		return nil, ErrStateMismatch
	}

	updates.add(OpUpdateSubtaskDone, &UpdateSubtaskDoneParams{
		Id:        body.TaskId,
		SubtaskId: body.SubtaskId,
		Done:      body.Done,
	})
	updates.add(OpUpdateSubtaskDoneAt, &UpdateSubtaskDoneAtParams{
		Id:        body.TaskId,
		SubtaskId: body.SubtaskId,
		DoneAt:    body.DoneAt,
	})
	return updates, nil
}

func CreateCategory(state *State, tx *Transaction) (*Updates, error) {
	updates := NewUpdates(tx)
	var body TxCreateCategoryBody
	if err := util.InterfaceToStruct(tx.Content, &body); err != nil {
		return nil, err
	}

	updates.add(OpCreateCategory, &CreateCategoryParams{
		Id:        body.Id,
		Title:     body.Title,
		Secret:    body.Secret,
		Locked:    body.Locked,
		Color:     body.Color,
		CreatedAt: body.CreatedAt,
	})
	return updates, nil
}

func DeleteCategory(state *State, tx *Transaction) (*Updates, error) {
	updates := NewUpdates(tx)
	var body TxDeleteCategoryBody
	if err := util.InterfaceToStruct(tx.Content, &body); err != nil {
		return nil, err
	}

	// if tasks that contains category exists, return error
	alreadyUsing := 0
	for _, task := range state.Tasks {
		for categoryId, _ := range task.Categories {
			if categoryId == body.Id {
				alreadyUsing++
				break
			}
		}
	}
	if alreadyUsing > 0 {
		return nil, fmt.Errorf("category is already used by %d tasks", alreadyUsing)
	}

	updates.add(OpDeleteCategory, &DeleteCategoryParams{
		Id: body.Id,
	})
	return updates, nil
}

func UpdateCategoryColor(state *State, tx *Transaction) (*Updates, error) {
	updates := NewUpdates(tx)
	var body TxUpdateCategoryColorBody
	if err := util.InterfaceToStruct(tx.Content, &body); err != nil {
		return nil, err
	}

	_, ok := state.Categories[body.Id]
	if !ok {
		log.Warnf("updating category color category(%s) not found", body.Id)
		return nil, ErrStateMismatch
	}

	updates.add(OpUpdateCategoryColor, &UpdateCategoryColorParams{
		Id:    body.Id,
		Color: body.Color,
	})
	return updates, nil
}
