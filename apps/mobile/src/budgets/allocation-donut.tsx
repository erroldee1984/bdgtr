import type { Allocation } from '@bdgtr/shared';
import { formatPHP } from '@bdgtr/shared';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { AppText } from '@/components/app-text';
import { colors, spacing } from '@/theme/tokens';

const SIZE = 160;
const STROKE = 18;
const R = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;
/** Gap between slices (in px along the ring), so neighbouring colours stay distinct. */
const GAP = 2;

export interface DonutCategory {
  id: string;
  name: string;
  colour: string;
  budgetMinor: number;
}

/** The donut's words (also what a screen reader hears). */
export function describeAllocation(a: Allocation, totalMinor: number): string {
  if (totalMinor <= 0) return `${formatPHP(a.allocatedMinor)} allocated, no total budget set`;
  const rest = a.unallocatedMinor < 0 ? `over-allocated by ${formatPHP(-a.unallocatedMinor)}` : `${formatPHP(a.unallocatedMinor)} unallocated`;
  return `${a.percentAllocated}% of ${formatPHP(totalMinor)} allocated, ${rest}`;
}

/**
 * Each category's share of the ring, as fractions of the whole circle. The
 * ring is the monthly budget; when categories add up to more than that
 * (over-allocated), it's their total instead, so every slice still fits.
 */
export function slices(categories: DonutCategory[], totalMinor: number): { id: string; colour: string; start: number; size: number }[] {
  const allocated = categories.reduce((s, c) => s + Math.max(0, c.budgetMinor), 0);
  const whole = Math.max(totalMinor, allocated);
  if (whole <= 0) return [];
  let start = 0;
  return categories
    .filter((c) => c.budgetMinor > 0)
    .map((c) => {
      const size = c.budgetMinor / whole;
      const slice = { id: c.id, colour: c.colour, start, size };
      start += size;
      return slice;
    });
}

/** "% of the total" per category, rounded, for the legend. */
function percentOf(minor: number, totalMinor: number): string {
  if (totalMinor <= 0) return '';
  const p = (minor * 100) / totalMinor;
  return p > 0 && p < 1 ? '<1%' : `${Math.round(p)}%`;
}

/**
 * The month's budget split by category (docs/PLAN.md §6.7): one coloured slice
 * per category in its own colour, the unallocated rest as the plain track.
 * A legend names every colour, and over-allocation shows a red plus icon AND
 * words, so colour is never the only signal (WCAG 1.4.1).
 */
export function AllocationDonut({ allocation, totalMinor, categories }: { allocation: Allocation; totalMinor: number; categories: DonutCategory[] }) {
  const over = allocation.unallocatedMinor < 0;
  const parts = slices(categories, totalMinor);
  const legend = categories.filter((c) => c.budgetMinor > 0);
  return (
    <View style={styles.wrap} testID="allocation-donut">
      <View style={styles.ring} role="img" aria-label={describeAllocation(allocation, totalMinor)}>
        <Svg width={SIZE} height={SIZE} aria-hidden>
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={colors.border} strokeWidth={STROKE} fill="none" />
          {parts.map((p) => {
            const length = Math.max(0, p.size * CIRCUMFERENCE - (parts.length > 1 ? GAP : 0));
            return (
              <Circle
                key={p.id}
                testID="donut-slice"
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                stroke={p.colour}
                strokeWidth={STROKE}
                fill="none"
                strokeDasharray={`${length} ${CIRCUMFERENCE}`}
                strokeDashoffset={-p.start * CIRCUMFERENCE}
                strokeLinecap="butt"
                transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              />
            );
          })}
        </Svg>
        <View style={styles.centre} aria-hidden>
          <AppText variant="headline">{`${allocation.percentAllocated}%`}</AppText>
          <AppText variant="caption" tone="secondary">
            allocated
          </AppText>
        </View>
      </View>
      <View style={styles.balance} aria-hidden>
        {over ? <MaterialCommunityIcons name="plus-circle" size={20} color={colors.danger} /> : null}
        <AppText tone={over ? 'danger' : 'secondary'}>
          {over ? `Over-allocated by ${formatPHP(-allocation.unallocatedMinor)}` : `${formatPHP(allocation.unallocatedMinor)} unallocated`}
        </AppText>
      </View>
      {legend.length ? (
        <View style={styles.legend} role="list" aria-label="Budget by category">
          {legend.map((c) => (
            <View key={c.id} style={styles.legendItem} role="listitem" accessible accessibilityLabel={`${c.name}, ${formatPHP(c.budgetMinor)}, ${percentOf(c.budgetMinor, totalMinor)} of the monthly budget`}>
              <View style={[styles.swatch, { backgroundColor: c.colour }]} />
              <AppText variant="caption">{`${c.name} ${percentOf(c.budgetMinor, totalMinor)}`}</AppText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.sm },
  ring: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  centre: { position: 'absolute', alignItems: 'center' },
  balance: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legend: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.md, marginTop: spacing.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  swatch: { width: 12, height: 12, borderRadius: 3 },
});
