import { barShares, type DashboardCategory, formatPHP } from '@bdgtr/shared';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { colors, radius, spacing } from '@/theme/tokens';

/** What one category's row says, in words (also its screen-reader label). */
export function describeCategory(c: DashboardCategory): string {
  const { over } = barShares(c.spentMinor, c.budgetMinor);
  if (c.budgetMinor <= 0) return `${c.name}: spent ${formatPHP(c.spentMinor)}, no budget set`;
  if (over > 0) return `${c.name}: spent ${formatPHP(c.spentMinor)} of ${formatPHP(c.budgetMinor)}, over by ${formatPHP(over)}`;
  return `${c.name}: spent ${formatPHP(c.spentMinor)} of ${formatPHP(c.budgetMinor)}, ${formatPHP(c.budgetMinor - c.spentMinor)} left`;
}

/**
 * "Spent vs Remaining per category" (docs/PLAN.md §6.2): stacked horizontal
 * bars, with a "View as table" alternative. Over budget is shown with text and
 * an icon, never colour alone (WCAG 1.4.1).
 */
export function SpendChart({ categories }: { categories: DashboardCategory[] }) {
  const [asTable, setAsTable] = useState(false);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <AppText variant="title">Spent vs remaining</AppText>
        <Button compact label={asTable ? 'View as chart' : 'View as table'} onPress={() => setAsTable((v) => !v)} />
      </View>
      {categories.length === 0 ? (
        <AppText tone="secondary">No categories yet.</AppText>
      ) : asTable ? (
        <View role="table" aria-label="Spending per category">
          <View role="row" testID="table-row" style={[styles.tr, styles.th]}>
            {['Category', 'Budget', 'Spent', 'Left'].map((h, i) => (
              <AppText key={h} role="columnheader" variant="caption" tone="secondary" style={i === 0 ? styles.cellName : styles.cell}>
                {h}
              </AppText>
            ))}
          </View>
          {categories.map((c) => {
            const left = c.budgetMinor - c.spentMinor;
            return (
              <View key={c.id} role="row" testID="table-row" style={styles.tr}>
                <AppText role="cell" style={styles.cellName}>
                  {c.name}
                  {c.isRemoved ? ' (removed)' : ''}
                </AppText>
                <AppText role="cell" style={styles.cell}>
                  {c.budgetMinor > 0 ? formatPHP(c.budgetMinor) : '—'}
                </AppText>
                <AppText role="cell" style={styles.cell}>
                  {formatPHP(c.spentMinor)}
                </AppText>
                <AppText role="cell" tone={c.budgetMinor > 0 && left < 0 ? 'danger' : 'primary'} style={styles.cell}>
                  {c.budgetMinor <= 0 ? '—' : left < 0 ? `Over ${formatPHP(-left)}` : formatPHP(left)}
                </AppText>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.bars}>
          {categories.map((c) => {
            const share = barShares(c.spentMinor, c.budgetMinor);
            const isOver = c.budgetMinor > 0 && share.over > 0;
            return (
              <View key={c.id} style={styles.barRow} accessible accessibilityLabel={describeCategory(c)}>
                <View style={styles.barLabel}>
                  <MaterialCommunityIcons name={c.icon} size={18} color={c.colour} aria-hidden />
                  <AppText variant="bodyStrong" style={styles.flex} numberOfLines={1}>
                    {c.name}
                    {c.isRemoved ? ' (removed)' : ''}
                  </AppText>
                  <AppText variant="caption" tone={isOver ? 'danger' : 'secondary'}>
                    {c.budgetMinor > 0 ? `${formatPHP(c.spentMinor)} / ${formatPHP(c.budgetMinor)}` : formatPHP(c.spentMinor)}
                  </AppText>
                </View>
                <View style={styles.track}>
                  {share.spent > 0 ? (
                    <View style={[styles.fill, { flex: share.spent, backgroundColor: isOver ? colors.danger : c.colour }]} />
                  ) : null}
                  {share.remaining > 0 ? <View style={[styles.rest, { flex: share.remaining }]} /> : null}
                </View>
                {isOver ? (
                  <View style={styles.overLine}>
                    <MaterialCommunityIcons name="alert" size={14} color={colors.danger} aria-hidden />
                    <AppText variant="caption" tone="danger">{`Over by ${formatPHP(share.over)}`}</AppText>
                  </View>
                ) : c.budgetMinor <= 0 ? (
                  <AppText variant="caption" tone="secondary">
                    No budget set
                  </AppText>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap' },
  bars: { gap: spacing.lg },
  barRow: { gap: spacing.xs },
  barLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  track: {
    flexDirection: 'row',
    height: 12,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
  },
  fill: { height: '100%' },
  rest: { height: '100%', backgroundColor: colors.surfaceRaised },
  overLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  tr: { flexDirection: 'row', paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: spacing.sm },
  th: { paddingTop: 0 },
  cellName: { flex: 2 },
  cell: { flex: 1.3, textAlign: 'right' },
});
