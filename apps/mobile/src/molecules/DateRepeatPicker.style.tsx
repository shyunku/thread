import AppText from '@/atoms/AppText';
import constantsStyle from '@/styles/constants.style';
import moment from 'moment';
import {useMemo} from 'react';
import {View} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import DateTimePickerStyle from './DateTimePicker.style';

interface DateRepeatPickerProps {
  date: Date | null;
  repeatPeriod: string | null;
}

const repeatTypes = (period: string | null) => {
  switch (period) {
    case 'day':
      return '매일';
    case 'week':
      return '매주';
    case 'month':
      return '매월';
    case 'year':
      return '매년';
  }
  return '';
};

const DateRepeatPicker = ({
  date,
  repeatPeriod,
}: DateRepeatPickerProps): JSX.Element => {
  const isActivated: boolean = useMemo(() => {
    return date != null && repeatPeriod != null && repeatPeriod.length > 0;
  }, [date, repeatPeriod]);

  const repeatPrefixLabel = useMemo(() => {
    if (isActivated) return repeatTypes(repeatPeriod);
    return '반복 없음';
  }, [repeatPeriod, isActivated]);

  const repeatPostfixLabel = useMemo(() => {
    if (!isActivated) return '';
    switch (repeatPeriod) {
      case 'day':
        return moment(date).format(' A h시 mm분');
      case 'week':
        return moment(date).format(' ddd요일');
      case 'month':
        return moment(date).format(' D일');
      case 'year':
        return moment(date).format(' M월 D일');
    }
    return '';
  }, [date, repeatPeriod, isActivated]);

  const mainColor = isActivated
    ? constantsStyle.highlightColor
    : constantsStyle.stdTextColor;
  const bgColor = isActivated
    ? constantsStyle.activeDateTimePickerColor
    : constantsStyle.inactiveDateTimePickerColor;

  return (
    <View testID="date-time-picker">
      <View
        testID="visible"
        style={[DateTimePickerStyle.visible, {backgroundColor: bgColor}]}>
        <View testID="icon-wrapper">
          <Icon name="repeat-outline" size={12} color={mainColor} />
        </View>
        <View
          testID="date-time-label"
          style={DateTimePickerStyle.dateTimeLabel}>
          <AppText size={11} color={mainColor}>
            {repeatPrefixLabel}
            {repeatPostfixLabel}
          </AppText>
        </View>
      </View>
    </View>
  );
};

export default DateRepeatPicker;
