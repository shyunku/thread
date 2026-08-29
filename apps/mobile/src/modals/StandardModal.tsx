import {StyleSheet, View} from 'react-native';
import Modal from 'react-native-modal';

const StandardModalStyle = StyleSheet.create({
  modal: {
    position: 'absolute',
    bottom: -20,
    left: 5,
    right: 5,
    alignSelf: 'center',
    backgroundColor: 'rgb(30, 35, 42)',
    paddingBottom: 20,
    borderTopRightRadius: 15,
    borderTopLeftRadius: 15,
  },
  modalWrapper: {
    padding: 20,
  },
});

export interface StandardModalProps {
  visible?: boolean;
  onBackdropPress?: () => void;
  children?: React.ReactNode;
}

const StandardModal = ({
  children,
  visible,
  onBackdropPress,
  ...props
}: StandardModalProps) => {
  return (
    <Modal
      testID="task-detail-modal"
      style={StandardModalStyle.modal}
      isVisible={visible}
      onBackdropPress={onBackdropPress}>
      <View testID="modal-wrapper" style={StandardModalStyle.modalWrapper}>
        {children}
      </View>
    </Modal>
  );
};

export default StandardModal;
