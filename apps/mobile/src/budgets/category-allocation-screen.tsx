import { can, formatPHP, type MonthBudgetCategory } from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { MonthSwitcher } from '@/components/month-switcher';
import { Screen } from '@/components/screen';
import { monthLabel } from '@/dashboard/format';
import { useHousehold } from '@/household/household-context';
import { resetCategoryMonthBudget, setCategoryMonthBudget, updateCategory } from '@/lib/api';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

import { AllocationDonut } from './allocation-donut';
import { BudgetAmountEditor } from './budget-amount-editor';
import { CustomBadge, saveProblem, useMonthParam } from './budgets-screen';
import { useMonthBudgets } from './use-month-budgets';

type Mode = 'defaults' | 'month';

/**
 * Budgets → Allocate per category (docs/PLAN.md §6.7): how much of the total
 * the categories take (donut), with Defaults | This month. Each row shows the
 * default and this month's value, a "Custom" badge and reset.
 */
export function CategoryAllocationScreen() {
  const { getToken } = useAuth();
  const { active } = useHousehold();
  const canManage = !!active && can(active.role, 'manage_budget_data');
  const [month, setMonth] = useMonthParam();
  const [mode, setMode] = useState<Mode>('month');
  const { budgets, error, reload, update, householdId } = useMonthBudgets(month);
  const [editing, setEditing] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const token = () => getToken();
  const label = monthLabel(month);

  const switchTo = (next: Mode) => {
    setMode(next);
    setEditing(null);
    setMessage(null);
  };

  async function save(c: MonthBudgetCategory, minor: number): Promise<string | null> {
    try {
      if (mode === 'defaults') {
        await updateCategory(token, householdId!, c.id, { defaultBudgetMinor: minor });
        reload();
      } else {
        update(await setCategoryMonthBudget(token, householdId!, month, c.id, minor));
      }
      setEditing(null);
      setMessage({ tone: 'success', text: mode === 'defaults' ? `${c.name} default saved.` : `${c.name} budget for ${label} saved.` });
      return null;
    } catch (err) {
      return saveProblem(err);
    }
  }

  async function reset(c: MonthBudgetCategory) {
    setResetting(c.id);
    setMessage(null);
    try {
      update(await resetCategoryMonthBudget(token, householdId!, month, c.id));
      setMessage({ tone: 'success', text: `${c.name} uses its default in ${label} again.` });
    } catch (err) {
      setMessage({ tone: 'danger', text: saveProblem(err) });
    } finally {
      setResetting(null);
    }
  }

  return (
    <Screen title="Allocate per category" subtitle={canManage ? undefined : 'Only the House Owner or a Co-Owner can change these.'}>
      <MonthSwitcher month={month} onChange={(m) => (setMonth(m), setEditing(null), setMessage(null))} />

      <View role="tablist" style={styles.segments}>
        {(
          [
            ['defaults', 'Defaults'],
            ['month', 'This month'],
          ] as const
        ).map(([value, text]) => (
          <Pressable
            key={value}
            role="tab"
            accessibilityState={{ selected: mode === value }}
            onPress={() => switchTo(value)}
            style={[styles.segment, mode === value && styles.segmentOn]}
          >
            <AppText variant="bodyStrong" style={mode === value ? styles.segmentTextOn : undefined}>
              {text}
            </AppText>
          </Pressable>
        ))}
      </View>

      {error && !budgets ? (
        <Card>
          <AppText tone="danger" role="alert">
            Couldn&apos;t load the budgets.
          </AppText>
          <Button label="Try again" compact onPress={reload} />
        </Card>
      ) : !budgets ? (
        <ActivityIndicator color={colors.primaryLight} accessibilityLabel="Loading budgets" />
      ) : (
        <>
          <Card>
            <AppText variant="caption" tone="secondary" style={styles.centred}>
              {mode === 'defaults'
                ? `Of the default monthly budget, ${formatPHP(budgets.defaultMonthlyBudgetMinor)}`
                : `Of the ${label} budget, ${formatPHP(budgets.totalBudgetMinor)}`}
            </AppText>
            <AllocationDonut
              allocation={mode === 'defaults' ? budgets.defaults : budgets.thisMonth}
              totalMinor={mode === 'defaults' ? budgets.defaultMonthlyBudgetMinor : budgets.totalBudgetMinor}
            />
          </Card>

          {message ? (
            <AppText tone={message.tone} role={message.tone === 'danger' ? 'alert' : undefined} aria-live="polite">
              {message.text}
            </AppText>
          ) : null}

          <Card>
            {budgets.categories.map((c) => {
              const custom = c.overrideMinor !== null;
              return (
                <View key={c.id} style={styles.row} testID="allocation-row">
                  <View style={styles.rowHead}>
                    <MaterialCommunityIcons name={c.icon} size={20} color={c.colour} aria-hidden />
                    <AppText variant="bodyStrong" style={styles.flex}>
                      {c.name}
                    </AppText>
                    {custom ? <CustomBadge /> : null}
                  </View>
                  {editing === c.id ? (
                    <BudgetAmountEditor
                      label={mode === 'defaults' ? `${c.name} default budget` : `${c.name} budget for ${label}`}
                      hint={mode === 'month' ? `The default is ${formatPHP(c.defaultBudgetMinor)}.` : 'Used for every month without its own value.'}
                      initialMinor={mode === 'defaults' ? c.defaultBudgetMinor : c.budgetMinor}
                      onCancel={() => setEditing(null)}
                      onSave={(minor) => save(c, minor)}
                    />
                  ) : (
                    <>
                      <View style={styles.values}>
                        <AppText tone={mode === 'defaults' ? undefined : 'secondary'}>{`Default ${formatPHP(c.defaultBudgetMinor)}`}</AppText>
                        <AppText tone={mode === 'month' ? undefined : 'secondary'}>{`${label} ${formatPHP(c.budgetMinor)}`}</AppText>
                      </View>
                      {canManage ? (
                        <View style={styles.actions}>
                          <Button
                            label="Edit"
                            icon="pencil-outline"
                            compact
                            accessibilityLabel={mode === 'defaults' ? `Edit ${c.name} default` : `Edit ${c.name} for ${label}`}
                            onPress={() => (setEditing(c.id), setMessage(null))}
                          />
                          {mode === 'month' && custom ? (
                            <Button
                              label="Reset to default"
                              icon="restore"
                              compact
                              busy={resetting === c.id}
                              accessibilityLabel={`Reset ${c.name} to default`}
                              onPress={() => void reset(c)}
                            />
                          ) : null}
                        </View>
                      ) : null}
                    </>
                  )}
                </View>
              );
            })}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centred: { textAlign: 'center' },
  segments: { flexDirection: 'row', borderRadius: radius.button, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  segment: { flex: 1, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.primary },
  segmentTextOn: { color: colors.onPrimary },
  row: { gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  values: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
