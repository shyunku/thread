import fontsStyle from '@/styles/fonts.style';
// import {Button, TextInput} from 'react-native';
import {FontWeight, FontWeightValue} from './AppText';
import {Button} from 'react-native-elements';
import {StyleSheet} from 'react-native';

const AppButtonStyle = StyleSheet.create({
  appButtonTitle: {
    fontFamily: fontsStyle.normal,
  },
  appButton: {
    backgroundColor: 'rgb(60, 90, 180)',
    paddingVertical: 5,
  },
});

export interface AppTextInputProps {
  title: string;
  style?: any;
  weight?: keyof typeof FontWeight | keyof typeof FontWeightValue;
  size?: number;
  icon?: any;
  color?: string;
  onPress?: () => void;
  onChangeText?: (text: string) => void;
}

const AppButton = ({
  title,
  style,
  weight,
  size,
  icon,
  color,
  onPress,
}: AppTextInputProps): JSX.Element => {
  const titleStyles: any = {...AppButtonStyle.appButtonTitle};
  if (weight) titleStyles.fontFamily = fontsStyle[weight];
  if (size) titleStyles.fontSize = size;
  if (color) titleStyles.color = color;

  let styles: any = {...AppButtonStyle.appButton};
  if (Array.isArray(style)) {
    for (let s of style) {
      styles = {...styles, ...s};
    }
  } else {
    styles = {...styles, ...style};
  }

  return (
    <Button
      title={title}
      titleStyle={titleStyles}
      buttonStyle={styles}
      icon={icon}
      onPress={onPress ?? (() => {})}
    />
  );
};

export default AppButton;
