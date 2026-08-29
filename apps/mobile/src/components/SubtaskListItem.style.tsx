import constantsStyle from '@/styles/constants.style';
import {StyleSheet} from 'react-native';

const SubtaskListItemStyle = StyleSheet.create({
  subtaskItem: {
    paddingVertical: 3,
    paddingHorizontal: 5,
    backgroundColor: 'rgb(50, 55, 63)',
    borderRadius: 2,
  },
  subtaskItem_notLast: {
    marginBottom: 5,
  },
  subtaskItemTitle: {
    height: 20,
    padding: 0,
    margin: 0,
    fontSize: 12,
    color: '#b4c8f0',
    paddingHorizontal: 6,
  },
});

export default SubtaskListItemStyle;
