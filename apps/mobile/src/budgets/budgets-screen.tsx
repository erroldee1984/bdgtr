import { can, formatPHP, isBudgetMonth, manilaDate, type MonthBudgets, yearMonthOf } from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { MonthSwitcher } from '@/components/month-switcher';
import { Screen } from '@/components/screen';
import { CachedNotice } from '@/offline/cached-notice';
import { monthLabel } from '@/dashboard/format';
import { useHousehold } from '@/household/household-context';
import { ApiError, resetMonthlyBudget, setMonthlyBudget, updateHousehold } from '@/lib/api';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

import { BudgetAmountEditor } from './budget-amount-editor';
import { useMonthBudgets } from './use-month-budgets';

/** What a failed save says. */
export function saveProblem(err: unknown): string {
  if (err instanceof ApiError && err.status === 403) return 'Only the House Owner or a Co-Owner can change budgets.';
  if (err instanceof ApiError && err.code === 'category_removed') return 'That category was removed.';
  return "Couldn't save. Check your connection and try again.";
}

/** One line about how much of the total the categories take. */
export function allocationSummary(a: MonthBudgets['thisMonth'], totalMinor: number): string {
  if (a.unallocatedMinor < 0) return `Over-allocated by ${formatPHP(-a.unallocatedMinor)}`;
  return `${formatPHP(a.allocatedMinor)} of ${formatPHP(totalMinor)} allocated · ${formatPHP(a.unallocatedMinor)} unallocated`;
}

export function CustomBadge() {
  return (
    <View style={styles.badge}>
      <AppText variant="caption" style={styles.badgeText}>
        Custom
      </AppText>
    </View>
  );
}

/** The month from ?month=YYYY-MM, else this month in Manila. */
export function useMonthParam(): [string, (m: string) => void] {
  const { month: raw } = useLocalSearchParams<{ month?: string }>();
  const [month, setMonth] = useState(raw && isBudgetMonth(raw) ? raw : yearMonthOf(manilaDate(new Date())));
  return [month, setMonth];
}

/** More → Budgets (docs/PLAN.md §6.6): the month's total, the default, and a link to each category's budget. */
export function BudgetsScreen() {
  const { getToken } = useAuth();
  const { active, refresh } = useHousehold();
  const canManage = !!active && can(active.role, 'manage_budget_data');
  const [month, setMonth] = useMonthParam();
  const { budgets, error, cachedAt, reload, update, householdId } = useMonthBudgets(month);
  const [editing, setEditing] = useState<'month' | 'default' | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [resetting, setResetting] = useState(false);
  const token = () => getToken();
  const label = monthLabel(month);

  const changeMonth = (m: string) => {
    setMonth(m);
    setEditing(null);
    setMessage(null);
  };

  async function resetMonth() {
    if (!householdId) return;
    setResetting(true);
    setMessage(null);
    try {
      update(await resetMonthlyBudget(token, householdId, month));
      setMessage({ tone: 'success', text: `${label} uses the default budget again.` });
    } catch (err) {
      setMessage({ tone: 'danger', text: saveProblem(err) });
    } finally {
      setResetting(false);
    }
  }

  return (
    <Screen
      title="Budgets"
      subtitle={canManage ? active?.householdName : 'Only the House Owner or a Co-Owner can change these.'}
    >
      <MonthSwitcher month={month} onChange={changeMonth} />
      <CachedNotice cachedAt={cachedAt} />

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
            <View style={styles.titleRow}>
              <AppText variant="bodyStrong" style={styles.flex}>{`${label} budget`}</AppText>
              {budgets.monthlyOverrideMinor !== null ? <CustomBadge /> : null}
            </View>
            {editing === 'month' ? (
              <BudgetAmountEditor
                label={`Budget for ${label}`}
                hint={`The default is ${formatPHP(budgets.defaultMonthlyBudgetMinor)}.`}
                initialMinor={budgets.totalBudgetMinor}
                onCancel={() => setEditing(null)}
                onSave={async (minor) => {
                  try {
                    update(await setMonthlyBudget(token, householdId!, month, minor));
                    setEditing(null);
                    setMessage({ tone: 'success', text: `${label} budget saved.` });
                    return null;
                  } catch (err) {
                    return saveProblem(err);
                  }
                }}
              />
            ) : (
              <>
                <AppText variant="headline">{formatPHP(budgets.totalBudgetMinor)}</AppText>
                <AppText variant="caption" tone="secondary">
                  {budgets.monthlyOverrideMinor !== null
                    ? `Set for ${label} only. The default is ${formatPHP(budgets.defaultMonthlyBudgetMinor)}.`
                    : 'The default monthly budget.'}
                </AppText>
                {canManage ? (
                  <View style={styles.actions}>
                    <Button label={`Change for ${label}`} icon="pencil-outline" compact onPress={() => setEditing('month')} />
                    {budgets.monthlyOverrideMinor !== null ? (
                      <Button label="Reset to default" icon="restore" compact busy={resetting} onPress={() => void resetMonth()} />
                    ) : null}
                  </View>
                ) : null}
              </>
            )}
          </Card>

          <Card>
            <AppText variant="bodyStrong">Default monthly budget</AppText>
            {editing === 'default' ? (
              <BudgetAmountEditor
                label="Default monthly budget"
                hint="Used for every month that doesn't have its own budget."
                initialMinor={budgets.defaultMonthlyBudgetMinor}
                onCancel={() => setEditing(null)}
                onSave={async (minor) => {
                  try {
                    await updateHousehold(token, householdId!, { defaultMonthlyBudgetMinor: minor });
                    setEditing(null);
                    setMessage({ tone: 'success', text: 'Default monthly budget saved.' });
                    reload();
                    await refresh(householdId!); // the Household screen and dashboard show it too
                    return null;
                  } catch (err) {
                    return saveProblem(err);
                  }
                }}
              />
            ) : (
              <>
                <AppText variant="title">{formatPHP(budgets.defaultMonthlyBudgetMinor)}</AppText>
                <AppText variant="caption" tone="secondary">
                  Used for every month that doesn&apos;t have its own budget.
                </AppText>
                {canManage ? <Button label="Edit default" icon="pencil-outline" compact onPress={() => setEditing('default')} /> : null}
              </>
            )}
          </Card>

          {message ? (
            <AppText tone={message.tone} role={message.tone === 'danger' ? 'alert' : undefined} aria-live="polite">
              {message.text}
            </AppText>
          ) : null}

          <Pressable
            role="link"
            accessibilityLabel={`Budget per Category. ${allocationSummary(budgets.thisMonth, budgets.totalBudgetMinor)}`}
            onPress={() => router.push({ pathname: '/budgets/categories', params: { month } })}
            style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]}
          >
            <MaterialCommunityIcons name="chart-donut" size={24} color={colors.primaryLight} aria-hidden />
            <View style={styles.flex}>
              <AppText variant="bodyStrong">Budget per Category</AppText>
              <AppText variant="caption" tone={budgets.thisMonth.unallocatedMinor < 0 ? 'danger' : 'secondary'}>
                {allocationSummary(budgets.thisMonth, budgets.totalBudgetMinor)}
              </AppText>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textSecondary} aria-hidden />
          </Pressable>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.button, borderWidth: 1, borderColor: colors.primaryLight },
  badgeText: { color: colors.primaryLight },
  pressed: { opacity: 0.75 },
  linkCard: {
    minHeight: MIN_TOUCH + 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
  },
});
