import type { BreakdownSort, Category } from '@bdgtr/shared';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

import type { RangeResult, RangeText } from './filter-form';

/** What the order button says for each sort. */
export function orderLabel(sort: BreakdownSort): string {
  if (sort.by === 'date') return sort.dir === 'desc' ? 'Newest first' : 'Oldest first';
  return sort.dir === 'desc' ? 'Highest first' : 'Lowest first';
}

function Chip({
  label,
  selected,
  role,
  onPress,
  icon,
  colour,
}: {
  label: string;
  selected: boolean;
  role: 'checkbox' | 'radio';
  onPress: () => void;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  colour?: string;
}) {
  return (
    <Pressable
      role={role}
      aria-checked={selected}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipOn, pressed && styles.pressed]}
    >
      {selected ? (
        <MaterialCommunityIcons name="check" size={18} color={colors.onPrimary} aria-hidden />
      ) : icon ? (
        <MaterialCommunityIcons name={icon} size={18} color={colour ?? colors.textSecondary} aria-hidden />
      ) : null}
      <AppText variant="bodyStrong" style={selected ? styles.chipOnText : undefined}>
        {label}
      </AppText>
    </Pressable>
  );
}

/**
 * Filters: category multi-select AND a ₱ range (docs/PLAN.md §6.8).
 * Changes apply as you make them; an invalid range is shown and ignored.
 */
export function FilterPanel({
  categories,
  categoryIds,
  onToggleCategory,
  range,
  rangeResult,
  onRangeChange,
  onClear,
}: {
  categories: Category[];
  categoryIds: readonly string[];
  onToggleCategory: (id: string) => void;
  range: RangeText;
  rangeResult: RangeResult;
  onRangeChange: (r: RangeText) => void;
  onClear: () => void;
}) {
  const errors: { minError?: string; maxError?: string } = rangeResult.ok ? {} : rangeResult;
  return (
    <View style={styles.wrap} testID="filter-panel">
      <View role="group" aria-label="Categories" style={styles.section}>
        <AppText variant="bodyStrong">Categories</AppText>
        <AppText variant="caption" tone="secondary">
          {categoryIds.length ? `${categoryIds.length} selected` : 'All categories'}
        </AppText>
        <View style={styles.chips}>
          {categories.map((c) => (
            <Chip
              key={c.id}
              role="checkbox"
              label={c.isRemoved ? `${c.name} (removed)` : c.name}
              icon={c.icon}
              colour={c.colour}
              selected={categoryIds.includes(c.id)}
              onPress={() => onToggleCategory(c.id)}
            />
          ))}
        </View>
      </View>

      <View role="group" aria-label="Amount" style={styles.section}>
        <AppText variant="bodyStrong">Amount</AppText>
        <View style={styles.rangeRow}>
          <View style={styles.flex}>
            <TextField
              label="Min"
              prefix="₱"
              value={range.min}
              onChangeText={(min) => onRangeChange({ ...range, min })}
              keyboardType="decimal-pad"
              error={errors.minError}
            />
          </View>
          <View style={styles.flex}>
            <TextField
              label="Max"
              prefix="₱"
              value={range.max}
              onChangeText={(max) => onRangeChange({ ...range, max })}
              keyboardType="decimal-pad"
              error={errors.maxError}
            />
          </View>
        </View>
      </View>

      <Button label="Clear filters" icon="filter-remove-outline" compact onPress={onClear} />
    </View>
  );
}

/** Sort: date or cost, and which way round. */
export function SortPanel({ sort, onSortChange }: { sort: BreakdownSort; onSortChange: (s: BreakdownSort) => void }) {
  return (
    <View style={styles.wrap} testID="sort-panel">
      <View style={styles.section}>
        <AppText variant="bodyStrong">Sort by</AppText>
        <View style={styles.chips}>
          <View role="radiogroup" aria-label="Sort by" style={styles.chips}>
            <Chip role="radio" label="Date" selected={sort.by === 'date'} onPress={() => onSortChange({ ...sort, by: 'date' })} />
            <Chip role="radio" label="Cost" selected={sort.by === 'amount'} onPress={() => onSortChange({ ...sort, by: 'amount' })} />
          </View>
          <Button
            label={orderLabel(sort)}
            icon={sort.dir === 'desc' ? 'arrow-down' : 'arrow-up'}
            compact
            accessibilityLabel={`Order: ${orderLabel(sort)}. Change`}
            onPress={() =>
              onSortChange({
                ...sort,
                dir: sort.dir === 'desc' ? 'asc' : 'desc',
              })
            }
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  section: { gap: spacing.sm },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rangeRow: { flexDirection: 'row', gap: spacing.md },
  chip: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipOnText: { color: colors.onPrimary },
  pressed: { opacity: 0.75 },
});
