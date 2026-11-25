import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

import { Button } from '@/components/button';

import { isoToLocalDate, localDateToIso } from './date-convert';

/** "Pick date": Android's native date picker. (Web: date-picker-button.web.tsx.) */
export function DatePickerButton({
  value,
  max,
  onChange,
  selected,
}: {
  value: string;
  max: string;
  onChange: (iso: string) => void;
  selected: boolean;
}) {
  return (
    <Button
      compact
      icon="calendar"
      label="Pick date"
      variant={selected ? 'primary' : 'secondary'}
      onPress={() =>
        DateTimePickerAndroid.open({
          value: isoToLocalDate(value),
          maximumDate: isoToLocalDate(max),
          mode: 'date',
          onChange: (event, date) => {
            if (event.type === 'set' && date) onChange(localDateToIso(date));
          },
        })
      }
    />
  );
}
