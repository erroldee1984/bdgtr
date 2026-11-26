import { can, formatPHP, type MonthBudgetCategory } from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { MonthSwitcher } from '@/components/month-switcher';
import { Screen } from '@/components/screen';
import { useHousehold } from '@/household/household-context';
import { resetCategoryMonthBudget, setCategoryMonthBudget } from '@/lib/api';
import { colors, spacing } from '@/theme/tokens';

import { AllocationDonut } from './allocation-donut';
import { BudgetAmountEditor } from './budget-amount-editor';
import { CustomBadge, saveProblem, useMonthParam } from './budgets-screen';
import { useMonthBudgets } from './use-month-budgets';

/**
 * Budgets → Budget per Category (docs/PLAN.md §6.7): the month chosen at the
 * top, how much of its total the categories take (donut), and each category's
 * budget with a "Custom" badge and reset. Category defaults are edited under
 * More → Categories, so they aren't shown here; labels don't repeat the month.
 */
export function CategoryAllocationScreen() {
  const { getToken } = useAuth();
  const { active } = useHousehold();
  const canManage = !!active && can(active.role, 'manage_budget_data');
  const [month, setMonth] = useMonthParam();
  const { budgets, error, reload, update, householdId } = useMonthBudgets(month);
  const [editing, setEditing] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const token = () => getToken();

  async function save(c: MonthBudgetCategory, minor: number): Promise<string | null> {
    try {
      update(await setCategoryMonthBudget(token, householdId!, month, c.id, minor));
      setEditing(null);
      setMessage({ tone: 'success', text: `${c.name} budget saved.` });
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
      setMessage({ tone: 'success', text: `${c.name} uses its default budget again.` });
    } catch (err) {
      setMessage({ tone: 'danger', text: saveProblem(err) });
    } finally {
      setResetting(null);
    }
  }

  return (
    <Screen title="Budget per Category" subtitle={canManage ? undefined : 'Only the House Owner or a Co-Owner can change these.'}>
      <MonthSwitcher month={month} onChange={(m) => (setMonth(m), setEditing(null), setMessage(null))} />

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
              {`Of the ${formatPHP(budgets.totalBudgetMinor)} monthly budget`}
            </AppText>
            <AllocationDonut allocation={budgets.thisMonth} totalMinor={budgets.totalBudgetMinor} />
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
                      label={`${c.name} budget`}
                      initialMinor={c.budgetMinor}
                      onCancel={() => setEditing(null)}
                      onSave={(minor) => save(c, minor)}
                    />
                  ) : (
                    <>
                      <AppText variant="title">{formatPHP(c.budgetMinor)}</AppText>
                      {canManage ? (
                        <View style={styles.actions}>
                          <Button
                            label="Edit"
                            icon="pencil-outline"
                            compact
                            accessibilityLabel={`Edit ${c.name}`}
                            onPress={() => (setEditing(c.id), setMessage(null))}
                          />
                          {custom ? (
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
  row: { gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
