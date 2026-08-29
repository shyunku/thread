import {StyleSheet} from 'react-native';

const TaskListViewStyle = StyleSheet.create({
  taskListView: {
    flexDirection: 'column',
  },
  taskGroups: {
    flexDirection: 'column',
  },
  taskGroup_notLast: {
    marginBottom: 20,
  },
  taskGroupHeader: {
    flexDirection: 'row',
    marginBottom: 15,
  },
  taskList: {
    flexDirection: 'column',
  },
});

export default TaskListViewStyle;
