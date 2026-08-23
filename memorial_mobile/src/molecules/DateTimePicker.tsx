import AppText from '@/atoms/AppText';
import constantsStyle from '@/styles/constants.style';
import moment from 'moment';
import {useMemo} from 'react';
import {View} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import DateTimePickerStyle from './DateTimePicker.style';

interface DateTimePickerProps {
  date: Date | null;
}

const DateTimePicker = ({date}: DateTimePickerProps): JSX.Element => {
  const dateTimeText = useMemo(() => {
    return date
      ? moment(date).format('YYYY년 MM월 DD일 a h시 mm분')
      : '기한 없음';
  }, [date]);

  const mainColor = date
    ? constantsStyle.highlightColor
    : constantsStyle.stdTextColor;
  const bgColor = date
    ? constantsStyle.activeDateTimePickerColor
    : constantsStyle.inactiveDateTimePickerColor;

  return (
    <View testID="date-time-picker">
      <View
        testID="visible"
        style={[DateTimePickerStyle.visible, {backgroundColor: bgColor}]}>
        <View testID="icon-wrapper">
          <Icon name="calendar-outline" size={12} color={mainColor} />
        </View>
        <View
          testID="date-time-label"
          style={DateTimePickerStyle.dateTimeLabel}>
          <AppText size={11} color={mainColor}>
            {dateTimeText}
          </AppText>
        </View>
      </View>
    </View>
  );
};

export default DateTimePicker;
