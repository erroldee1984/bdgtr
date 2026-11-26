import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { monthLabel } from '@/dashboard/format';
import { colors, MIN_TOUCH } from '@/theme/tokens';

/** "2026-11" moved by `by` months, e.g. shiftMonth("2026-01", -1) = "2025-12". */
export function shiftMonth(yearMonth: string, by: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** ‹ November 2026 › with 48dp arrows; the month is announced when it changes. */
export function MonthSwitcher({ month, onChange, max }: { month: string; onChange: (month: string) => void; max?: string }) {
  const atMax = max !== undefined && month >= max;
  return (
    <View style={styles.nav}>
      <Pressable role="button" accessibilityLabel="Previous month" onPress={() => onChange(shiftMonth(month, -1))} style={styles.arrow}>
        <MaterialCommunityIcons name="chevron-left" size={28} color={colors.textPrimary} aria-hidden />
      </Pressable>
      <AppText variant="title" aria-live="polite">
        {monthLabel(month)}
      </AppText>
      <Pressable
        role="button"
        accessibilityLabel="Next month"
        accessibilityState={{ disabled: atMax }}
        disabled={atMax}
        onPress={() => onChange(shiftMonth(month, 1))}
        style={[styles.arrow, atMax && styles.off]}
      >
        <MaterialCommunityIcons name="chevron-right" size={28} color={colors.textPrimary} aria-hidden />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  off: { opacity: 0.35 },
});
