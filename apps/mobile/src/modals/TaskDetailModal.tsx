import AppButton from '@/atoms/AppButton';
import AppText from '@/atoms/AppText';
import SubtaskListItem from '@/components/SubtaskListItem';
import DateRepeatPicker from '@/molecules/DateRepeatPicker.style';
import DateTimePicker from '@/molecules/DateTimePicker';
import SubTask from '@/objects/Subtask';
import Task from '@/objects/Task';
import {fastInterval, fromRelativeTime} from '@/util/common';
import {useEffect, useMemo, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import StandardModal, {StandardModalProps} from './StandardModal';
import TaskDetailModalStyle from './TaskDetailModal.style';

interface TaskDetailModalProps extends StandardModalProps {
  task: Task | null;
}

const TaskDetailModal = ({task, ...rest}: TaskDetailModalProps) => {
  const [counter, setCounter] = useState(0);
  const subtasks: SubTask[] = useMemo(() => {
    return task?.subTasks != null ? Array.from(task.subTasks.values()) : [];
  }, [task]);

  const remainTime = useMemo((): number | null => {
    if (task?.dueDate == null) return null;
    const taskTime = task?.dueDate?.getTime() ?? null;
    if (taskTime == null) return null;
    const now = Date.now();
    const diff = taskTime - now;
    return diff;
  }, [task, counter]);

  const remainTimeText = useMemo(() => {
    if (remainTime == null) return '-';
    return `${fromRelativeTime(Math.abs(remainTime))}`;
  }, [remainTime]);

  useEffect(() => {
    let counterThread = fastInterval(() => {
      setCounter(counter => counter + 1);
    }, 1000);
    return () => {
      clearInterval(counterThread);
    };
  }, []);

  return (
    <StandardModal {...rest}>
      <View
        testID="task-detail-title"
        style={TaskDetailModalStyle.taskDetailTitle}>
        <AppText size={20} weight="bold">
          {task?.title || '-'}
        </AppText>
      </View>
      <View testID="task-options">
        <View
          testID="task-option"
          style={[
            TaskDetailModalStyle.taskOption,
            TaskDetailModalStyle.taskOption_notLast,
          ]}>
          <DateTimePicker date={task?.dueDate ?? null} />
        </View>
        {task?.dueDate != null && task?.repeatPeriod != null && (
          <View
            testID="task-option"
            style={[
              TaskDetailModalStyle.taskOption,
              TaskDetailModalStyle.taskOption_notLast,
            ]}>
            <DateRepeatPicker
              date={task?.dueDate ?? null}
              repeatPeriod={task?.repeatPeriod ?? null}
            />
          </View>
        )}
      </View>
      <ScrollView
        testID="task-subtasks"
        style={TaskDetailModalStyle.taskSubtasks}>
        {subtasks.map((subtask, index) => {
          return (
            <SubtaskListItem
              key={subtask.id}
              subtask={subtask}
              notLast={index < subtasks.length - 1}
            />
          );
        })}
      </ScrollView>
      <View testID="remain-timer" style={TaskDetailModalStyle.remainTimer}>
        <AppText
          size={10}
          weight="bold"
          style={TaskDetailModalStyle.remainTimerLabel}>
          {remainTime && remainTime < 0 ? '지난 시간' : '남은 시간'}
        </AppText>
        <AppText
          size={16}
          weight="normal"
          style={TaskDetailModalStyle.remainTimerText}>
          {remainTime ? fromRelativeTime(Math.abs(remainTime)) : '기한 없음'}
        </AppText>
      </View>
      <AppButton title={'하위 할 일 또는 이벤트 추가'} size={11} />
    </StandardModal>
  );
};

export default TaskDetailModal;
