import {StyleSheet} from 'react-native';

const TaskDetailModalStyle = StyleSheet.create({
  taskDetailTitle: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(102,121,154,0.43)',
    paddingBottom: 8,
    marginBottom: 10,
  },
  taskOption: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  taskOption_notLast: {
    marginBottom: 8,
  },
  taskSubtasks: {
    marginTop: 15,
    maxHeight: 200,
    marginBottom: 15,
  },
  remainTimer: {
    marginBottom: 15,
    // alignItems: 'flex-end',
  },
  remainTimerLabel: {
    color: 'rgb(76, 88, 110)',
  },
  remainTimerText: {
    color: 'rgb(77, 110, 204)',
  },
});

export default TaskDetailModalStyle;
