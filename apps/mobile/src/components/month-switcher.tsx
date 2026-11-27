import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Dialog } from '@/components/dialog';
import { monthLabel } from '@/dashboard/format';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

/** "2026-11" moved by `by` months, e.g. shiftMonth("2026-01", -1) = "2025-12". */
export function shiftMonth(yearMonth: string, by: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const SHORT = new Intl.DateTimeFormat('en-PH', { month: 'short', timeZone: 'UTC' });
const LONG = new Intl.DateTimeFormat('en-PH', { month: 'long', timeZone: 'UTC' });
const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(Date.UTC(2026, i, 1));
  return { num: String(i + 1).padStart(2, '0'), short: SHORT.format(d), long: LONG.format(d) };
});
const MIN_YEAR = 2000; // the API's oldest budget month
const MAX_YEAR = 2099;

/** Year ‹ › and a 3×4 grid of months; months after `max` can't be picked. */
function MonthPicker({ month, max, onPick, onClose }: { month: string; max?: string; onPick: (m: string) => void; onClose: () => void }) {
  const [year, setYear] = useState(Number(month.slice(0, 4)));
  const maxYear = max ? Math.min(Number(max.slice(0, 4)), MAX_YEAR) : MAX_YEAR;
  return (
    <Dialog visible title="Choose a month" onClose={onClose} actions={<Button label="Cancel" compact onPress={onClose} />}>
      <View style={styles.nav}>
        <Pressable
          role="button"
          accessibilityLabel="Previous year"
          accessibilityState={{ disabled: year <= MIN_YEAR }}
          disabled={year <= MIN_YEAR}
          onPress={() => setYear(year - 1)}
          style={[styles.arrow, year <= MIN_YEAR && styles.off]}
        >
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.textPrimary} aria-hidden />
        </Pressable>
        <AppText variant="title" aria-live="polite">
          {String(year)}
        </AppText>
        <Pressable
          role="button"
          accessibilityLabel="Next year"
          accessibilityState={{ disabled: year >= maxYear }}
          disabled={year >= maxYear}
          onPress={() => setYear(year + 1)}
          style={[styles.arrow, year >= maxYear && styles.off]}
        >
          <MaterialCommunityIcons name="chevron-right" size={28} color={colors.textPrimary} aria-hidden />
        </Pressable>
      </View>
      <View style={styles.grid}>
        {MONTHS.map((m) => {
          const value = `${year}-${m.num}`;
          const selected = value === month;
          const off = max !== undefined && value > max;
          return (
            <Pressable
              key={m.num}
              role="button"
              accessibilityLabel={`${m.long} ${year}`}
              accessibilityState={{ selected, disabled: off }}
              disabled={off}
              onPress={() => onPick(value)}
              style={({ pressed }) => [styles.cell, selected && styles.cellSelected, off && styles.off, pressed && styles.pressed]}
            >
              <AppText variant="bodyStrong" style={selected ? styles.cellSelectedText : undefined}>
                {m.short}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </Dialog>
  );
}

/**
 * ‹ November 2026 › with 48dp arrows; the month is announced when it changes.
 * Tapping the month opens a picker to jump to any month.
 */
export function MonthSwitcher({ month, onChange, max }: { month: string; onChange: (month: string) => void; max?: string }) {
  const atMax = max !== undefined && month >= max;
  const [picking, setPicking] = useState(false);
  return (
    <View style={styles.nav}>
      <Pressable role="button" accessibilityLabel="Previous month" onPress={() => onChange(shiftMonth(month, -1))} style={styles.arrow}>
        <MaterialCommunityIcons name="chevron-left" size={28} color={colors.textPrimary} aria-hidden />
      </Pressable>
      <Pressable
        role="button"
        accessibilityLabel={`${monthLabel(month)}. Choose a month`}
        onPress={() => setPicking(true)}
        style={({ pressed }) => [styles.label, pressed && styles.pressed]}
      >
        <AppText variant="title" aria-live="polite">
          {monthLabel(month)}
        </AppText>
        <MaterialCommunityIcons name="menu-down" size={24} color={colors.textSecondary} aria-hidden />
      </Pressable>
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
      {picking ? (
        <MonthPicker
          month={month}
          {...(max !== undefined ? { max } : {})}
          onClose={() => setPicking(false)}
          onPick={(m) => {
            setPicking(false);
            if (m !== month) onChange(m);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  label: { minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.button },
  off: { opacity: 0.35 },
  pressed: { opacity: 0.75 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  cell: {
    width: '30%',
    flexGrow: 1,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.button,
    backgroundColor: colors.surface,
  },
  cellSelected: { backgroundColor: colors.primary },
  cellSelectedText: { color: colors.onPrimary },
});
