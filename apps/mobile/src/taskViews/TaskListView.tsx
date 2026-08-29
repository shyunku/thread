import AppText from '@/atoms/AppText';
import TaskListItem from '@/components/TaskListItem';
import Task from '@/objects/Task';
import TaskListViewStyle from '@/taskViews/TaskListView.style';
import {useMemo} from 'react';
import {View} from 'react-native';

interface TaskListViewProps {
  taskMap: {[key: string]: Task};
  filter: Function;
  sorter: (a: Task, b: Task) => number;
}

const TaskListView = ({
  taskMap,
  filter,
  sorter,
  ...rest
}: TaskListViewProps): JSX.Element => {
  const sortedTaskList: Task[] = useMemo(() => {
    let sorted: Task[] = [];
    if (Object.keys(taskMap).length == 0) return sorted;

    // find first
    let iterTask: Task | null = null;
    for (let tid in taskMap) {
      const task = taskMap[tid];
      if (task.prev == null) {
        iterTask = task;
      }
    }
    if (iterTask == null) {
      console.log(`No first task found`);
    } else {
      while (iterTask != null) {
        sorted.push(iterTask);
        iterTask = taskMap[iterTask.next ?? ''];
      }
    }
    // sort by outer sorter if provided
    if (sorter != null && typeof sorter == 'function') {
      sorted = sorted.sort(sorter);
    }
    return sorted;
  }, [taskMap, sorter]);

  const [doneTaskList, notDoneTaskList] = useMemo(() => {
    const doneTaskList: Task[] = [];
    const notDoneTaskList: Task[] = [];

    for (let i = 0; i < sortedTaskList.length; i++) {
      const task = sortedTaskList[i];
      // console.log(`${i}/${sortedTaskList.length}`, task instanceof Task);
      if (!filter(task)) continue;
      (task.done ? doneTaskList : notDoneTaskList).push(task);
    }

    return [doneTaskList, notDoneTaskList];
  }, [sortedTaskList]);

  return (
    <View testID="task-list-view" style={TaskListViewStyle.taskListView}>
      <View testID="task-groups" style={TaskListViewStyle.taskGroups}>
        <TaskGroup label="해야할 일" taskList={notDoneTaskList} {...rest} />
        <TaskGroup label="완료됨" taskList={doneTaskList} {...rest} />
      </View>
    </View>
  );
};

interface TaskGroupProps {
  label: string;
  taskList: Task[];
}

const TaskGroup = ({label, taskList, ...rest}: TaskGroupProps): JSX.Element => {
  return (
    <View testID="task-group" style={TaskListViewStyle.taskGroup_notLast}>
      <View
        testID="task-group-header"
        style={TaskListViewStyle.taskGroupHeader}>
        <AppText size={13} weight="bold" color="#545a60">
          {label}
        </AppText>
      </View>
      <View testID="task-list" style={TaskListViewStyle.taskList}>
        {taskList.map((task, index) => {
          return (
            <TaskListItem
              key={index}
              task={task}
              notLast={index < taskList.length - 1}
              {...rest}
            />
          );
        })}
      </View>
    </View>
  );
};

export default TaskListView;
