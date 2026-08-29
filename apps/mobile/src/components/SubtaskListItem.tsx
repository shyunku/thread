import AppTextInput from '@/atoms/AppTextInput';
import SubTask from '@/objects/Subtask';
import {TextInput, View} from 'react-native';
import SubtaskListItemStyle from './SubtaskListItem.style';

interface SubtaskListItemProps {
  subtask: SubTask;
  notLast?: boolean;
}

const SubtaskListItem = ({
  subtask,
  notLast,
}: SubtaskListItemProps): JSX.Element => {
  const subtaskItemStyles: any[] = [SubtaskListItemStyle.subtaskItem];
  if (notLast) subtaskItemStyles.push(SubtaskListItemStyle.subtaskItem_notLast);

  return (
    <View testID="subtask-item" style={subtaskItemStyles}>
      <AppTextInput
        size={10}
        value={subtask.title}
        style={SubtaskListItemStyle.subtaskItemTitle}></AppTextInput>
    </View>
  );
};

export default SubtaskListItem;
