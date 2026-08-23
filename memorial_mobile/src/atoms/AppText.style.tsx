import constantsStyle from '@/styles/constants.style';
import fontsStyle from '@/styles/fonts.style';
import {StyleSheet} from 'react-native';

const AppTextStyle = StyleSheet.create({
  appText: {
    fontSize: 18,
    color: constantsStyle.stdTextColor,
    fontFamily: fontsStyle.normal,
  },
});

export default AppTextStyle;
