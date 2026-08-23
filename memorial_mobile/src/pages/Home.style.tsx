import constantsStyle from '@/styles/constants.style';
import {StyleSheet} from 'react-native';

const HomeStyle = StyleSheet.create({
  homeContainer: {
    flex: 1,
    flexDirection: 'column',
    paddingHorizontal: 25,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    backgroundColor: constantsStyle.mainBgColor,
    // paddingVertical: 15,
    // backgroundColor: 'red',
  },
  header: {
    position: 'relative',
    borderBottomColor: 'rgba(102,121,154,0.43)',
    borderBottomWidth: 1,

    // backgroundColor: 'red',
    backgroundColor: `rgba(${constantsStyle.mainBgColor.slice(4, -1)}, 0.9)`,
  },
  syncSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  titleSection: {
    marginBottom: 15,
    paddingTop: 15,
  },
  optionSection: {
    flexDirection: 'row',
    marginBottom: 10,
    justifyContent: 'space-between',
  },
  viewOptions: {
    flexDirection: 'row',
  },
  viewOption: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: constantsStyle.stdBtnColor,
    borderRadius: 2,
  },
  viewOption_selected: {
    borderColor: constantsStyle.highlightColor,
  },
  viewOption_notLast: {
    marginRight: 5,
  },
  viewOptionText: {
    color: constantsStyle.stdBtnTextColor,
  },
  viewOptionText_selected: {
    color: constantsStyle.highlightColor,
  },
  body: {
    flex: 1,
    paddingTop: 20,
    flexDirection: 'column',
  },
  taskDetailModal: {
    position: 'absolute',
    bottom: -20,
    left: 10,
    right: 10,
    alignSelf: 'center',
    backgroundColor: 'rgb(35, 40, 47)',
    paddingBottom: 20,
    borderTopRightRadius: 15,
    borderTopLeftRadius: 15,
  },
  modalWrapper: {
    padding: 20,
  },
});

export default HomeStyle;
