import fontsStyle from '@/styles/fonts.style';
import {TextInput} from 'react-native';
import {FontWeight, FontWeightValue} from './AppText';

export interface AppTextInputProps {
  placeholder?: string;
  value?: string | null;
  style?: any;
  weight?: keyof typeof FontWeight | keyof typeof FontWeightValue;
  size?: number;
  secureTextEntry?: boolean;
  spellCheck?: boolean;
  autoCorrect?: boolean;
  onChangeText?: (text: string) => void;
}

const AppTextInput = ({
  placeholder,
  value,
  style,
  weight,
  size,
  secureTextEntry,
  spellCheck,
  autoCorrect,
  onChangeText,
}: AppTextInputProps): JSX.Element => {
  const styles = {...style};
  if (weight) styles.fontFamily = fontsStyle[weight];
  else styles.fontFamily = fontsStyle.normal;
  if (size) styles.fontSize = size;

  return (
    <TextInput
      placeholder={placeholder}
      style={styles}
      onChangeText={onChangeText}
      secureTextEntry={secureTextEntry ?? false}
      spellCheck={spellCheck ?? false}
      autoCorrect={autoCorrect ?? false}
      autoCapitalize="none"
      value={value ?? ''}></TextInput>
  );
};

export default AppTextInput;
