import Task from '@/objects/Task';
import {useDispatch} from 'react-redux';
import {setCategories, setTasks} from '@/store/stateSlice';
import Category from '@/objects/Category';
import SubTask from '@/objects/Subtask';

const convertDate = (date: any) => {
  return date ? new Date(date) : null;
};

const convertStr = (str: any) => {
  return str != null && typeof str === 'string' && str.length > 0 ? str : null;
};

export const applyInitialState = (
  dispatch: Function,
  blockNumber: number,
  data: any,
) => {
  const {categories, tasks} = data;
  const taskMap: {[key: string]: any} = {};
  const categoryMap: {[key: string]: any} = {};

  for (let cid in categories) {
    const rawCategory = categories[cid];
    const category = new Category(rawCategory.title, rawCategory.secret, false);
    category.id = cid;
    category.createdAt = convertDate(rawCategory.createdAt);
    categoryMap[cid] = category;
  }

  for (let tid in tasks) {
    const rawTask = tasks[tid];
    const task = new Task(rawTask.title);
    task.id = tid;
    task.repeatStartAt = convertDate(rawTask.repeatStartAt);
    task.repeatPeriod = rawTask.repeatPeriod;
    task.memo = rawTask.memo;
    task.dueDate = convertDate(rawTask.dueDate);
    task.done = rawTask.done;
    task.doneAt = convertDate(rawTask.doneAt);
    task.createdAt = convertDate(rawTask.createdAt);

    const rawTaskCategories = rawTask.categories;
    for (let cid in rawTaskCategories) {
      const category: Category = categoryMap[cid];
      task.categories.set(category.id, category);
    }

    const rawSubtasks = rawTask.subtasks;
    for (let sid in rawSubtasks) {
      let rawSubtask = rawSubtasks[sid];
      let subtask = new SubTask(rawSubtask.title);
      subtask.id = sid;
      subtask.createdAt = convertDate(rawSubtask.createdAt);
      subtask.done = rawSubtask.done;
      subtask.doneAt = convertDate(rawSubtask.doneAt);
      subtask.dueDate = convertDate(rawSubtask.dueDate);
      task.subTasks.set(subtask.id, subtask);
    }
    taskMap[tid] = task;
  }

  for (let tid in taskMap) {
    let task = taskMap[tid];
    let rawTask = tasks[tid];
    task.next = convertStr(rawTask.next);
    const nextTask = taskMap[rawTask.next];
    if (nextTask != null) {
      nextTask.prev = task.id;
    }
  }

  dispatch(setCategories(categoryMap));
  dispatch(setTasks(taskMap));
};
