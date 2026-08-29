import AppText from '@/atoms/AppText';
import {TouchableOpacity, View} from 'react-native';
import TaskListItemStyle from './TaskListItem.style';
import Task from '@/objects/Task';
import moment from 'moment';
import {useMemo} from 'react';
import 'moment/locale/ko';

interface TaskListItemProps {
  task: Task;
  notLast?: boolean;
  onTaskSelect?: (taskId?: string) => void;
}

const TaskListItem = ({
  task,
  notLast,
  onTaskSelect,
}: TaskListItemProps): JSX.Element => {
  const taskListItemStyles: any[] = [TaskListItemStyle.taskListItem];
  if (notLast) taskListItemStyles.push(TaskListItemStyle.task_notLast);

  const taskDueDateText: string = useMemo(() => {
    if (task.dueDate) {
      const dueDate = moment(task.dueDate);
      return dueDate.format('YY.MM.DD a h시 mm분');
    } else {
      return '';
    }
  }, [task.dueDate]);

  const taskRepeatLabel = useMemo(() => {
    if (!task?.repeatPeriod || !task?.repeatStartAt) return '';
    switch (task.repeatPeriod) {
      case 'day':
        return moment(task.repeatStartAt).format('매일 A h시 mm분');
      case 'week':
        return moment(task.repeatStartAt).format('매주 ddd요일');
      case 'month':
        return moment(task.repeatStartAt).format('매월 D일');
      case 'year':
        return moment(task.repeatStartAt).format('매년 M월 D일');
    }
    return '';
  }, [task]);

  return (
    <TouchableOpacity
      testID="task"
      style={[taskListItemStyles, {opacity: task.done ? 0.4 : 1}]}
      onPress={e => {
        onTaskSelect?.(task.id);
      }}>
      <View testID="task-header" style={TaskListItemStyle.taskHeader}>
        <View testID="left-section" style={TaskListItemStyle.leftSection}>
          <View testID="task-title" style={TaskListItemStyle.taskTitle}>
            <AppText
              size={13}
              style={TaskListItemStyle.taskTitleText}
              numberOfLines={1}>
              {task?.title}
            </AppText>
          </View>
        </View>
        <View testID="right-section" style={TaskListItemStyle.rightSection}>
          <View testID="task-date-info" style={TaskListItemStyle.taskDateInfo}>
            <View testID="task-due-date">
              <AppText size={8} style={TaskListItemStyle.taskDateInfoText}>
                {taskDueDateText}
              </AppText>
            </View>
            {task?.repeatPeriod && (
              <View testID="task-repeat-period">
                <AppText
                  size={8}
                  style={[
                    TaskListItemStyle.taskDateInfoText,
                    TaskListItemStyle.taskRepeatPeriodText,
                  ]}>
                  ({taskRepeatLabel})
                </AppText>
              </View>
            )}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

export default TaskListItem;
