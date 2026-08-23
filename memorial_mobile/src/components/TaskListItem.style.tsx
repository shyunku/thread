import constantsStyle from '@/styles/constants.style';
import {StyleSheet} from 'react-native';

const TaskListItemStyle = StyleSheet.create({
  taskListItem: {
    backgroundColor: 'gray',
    borderRadius: 2,
    overflow: 'hidden',
  },
  task_notLast: {
    marginBottom: 8,
  },
  taskHeader: {
    backgroundColor: 'rgb(39, 41, 45)',
    paddingHorizontal: 16,
    height: 35,
    alignItems: 'center',
    flexDirection: 'row',
  },
  leftSection: {
    flexDirection: 'row',
    flex: 1,
    overflow: 'hidden',
  },
  rightSection: {
    flexDirection: 'row',
    marginLeft: 10,
  },
  taskTitle: {},
  taskTitleText: {
    color: constantsStyle.taskItemTitleColor,
    // maxWidth: 130,
  },
  subtasksStatus: {
    paddingVertical: 2,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: constantsStyle.taskItemSubtaskColor,
    borderRadius: 20,
  },
  subtasksStatusText: {
    color: constantsStyle.highlightColor,
  },
  taskDateInfo: {
    marginLeft: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  taskDateInfoText: {
    color: constantsStyle.taskItemDateColor,
    // color: '#aaa',
  },
  taskRepeatPeriodText: {
    marginLeft: 3,
  },
});

export default TaskListItemStyle;
