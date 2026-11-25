import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

/** "Pick date" on the web: the browser's own date field (<input type="date">). */
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
    <View style={[styles.wrap, selected && styles.selected]}>
      <AppText variant="bodyStrong" style={styles.label} aria-hidden>
        Pick date
      </AppText>
      <input
        type="date"
        aria-label="Pick date"
        value={value}
        max={max}
        min="2000-01-01"
        onChange={(e) => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) onChange(e.target.value);
        }}
        style={{
          background: 'transparent',
          color: colors.textPrimary,
          border: 'none',
          fontSize: 16,
          colorScheme: 'dark',
          minHeight: MIN_TOUCH - 8,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH,
    paddingHorizontal: spacing.md,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selected: { borderColor: colors.primaryLight, backgroundColor: colors.surfaceRaised },
  label: { color: colors.primaryLight },
});
