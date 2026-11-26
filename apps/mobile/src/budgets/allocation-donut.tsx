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

/** The donut's words (also what a screen reader hears). */
export function describeAllocation(a: Allocation, totalMinor: number): string {
  if (totalMinor <= 0) return `${formatPHP(a.allocatedMinor)} allocated, no total budget set`;
  const rest = a.unallocatedMinor < 0 ? `over-allocated by ${formatPHP(-a.unallocatedMinor)}` : `${formatPHP(a.unallocatedMinor)} unallocated`;
  return `${a.percentAllocated}% of ${formatPHP(totalMinor)} allocated, ${rest}`;
}

/**
 * "% of the total allocated" ring with the unallocated balance below
 * (docs/PLAN.md §6.7). Over-allocation shows a red plus icon AND words, never
 * colour alone (WCAG 1.4.1).
 */
export function AllocationDonut({ allocation, totalMinor }: { allocation: Allocation; totalMinor: number }) {
  const over = allocation.unallocatedMinor < 0;
  const filled = Math.min(allocation.percentAllocated, 100) / 100;
  return (
    <View style={styles.wrap} role="img" aria-label={describeAllocation(allocation, totalMinor)} testID="allocation-donut">
      <View style={styles.ring} aria-hidden>
        <Svg width={SIZE} height={SIZE}>
          <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={colors.border} strokeWidth={STROKE} fill="none" />
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            stroke={over ? colors.danger : colors.primary}
            strokeWidth={STROKE}
            fill="none"
            strokeDasharray={`${CIRCUMFERENCE * filled} ${CIRCUMFERENCE}`}
            strokeLinecap="butt"
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>
        <View style={styles.centre}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.sm },
  ring: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  centre: { position: 'absolute', alignItems: 'center' },
  balance: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
