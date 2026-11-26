import { formatPHP } from '@bdgtr/shared';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { CachedNotice } from '@/offline/cached-notice';
import { useOutbox } from '@/offline/outbox-context';
import { withPending } from '@/offline/pending';
import { SpendChart } from '@/dashboard/spend-chart';
import { greetingName, monthLabel } from '@/dashboard/format';
import { useDashboard } from '@/dashboard/use-dashboard';
import { useHousehold } from '@/household/household-context';
import { HouseholdSwitcher } from '@/household/household-switcher';
import { colors, radius, spacing } from '@/theme/tokens';

/** Dashboard (docs/PLAN.md §6.2). */
export default function DashboardScreen() {
  const { active, state } = useHousehold();
  const { dashboard: fromServer, error, cachedAt, reload } = useDashboard();
  const { items } = useOutbox();
  // Spends waiting to be sent count already, so "remaining" stays honest offline.
  const { dashboard, pendingMinor } = fromServer && active ? withPending(fromServer, items, active.householdId) : { dashboard: fromServer, pendingMinor: 0 };
  const name = greetingName(state.status === 'ready' ? state.me.user.name : null);

  return (
    <Screen
      title={name ? `Hi, ${name}` : 'Hi there'}
      subtitle={[active?.householdName, dashboard ? monthLabel(dashboard.month) : null].filter(Boolean).join(' · ')}
    >
      <HouseholdSwitcher />
      <CachedNotice cachedAt={cachedAt} />
      {!dashboard ? (
        error ? (
          <Card>
            <AppText tone="danger" role="alert">
              Couldn&apos;t load this month&apos;s numbers.
            </AppText>
            <Button label="Try again" compact onPress={() => void reload()} />
          </Card>
        ) : (
          <ActivityIndicator color={colors.primaryLight} accessibilityLabel="Loading this month" />
        )
      ) : (
        <>
          <Card>
            <AppText variant="caption" tone="secondary">
              Remaining this month
            </AppText>
            {dashboard.remainingMinor < 0 ? (
              // Over budget: bold, red, an icon AND words (never colour alone).
              <View style={styles.overRow} accessible accessibilityLabel={`Over budget by ${formatPHP(-dashboard.remainingMinor)}`}>
                <MaterialCommunityIcons name="alert" size={28} color={colors.danger} aria-hidden />
                <AppText variant="headline" tone="danger">{`Over by ${formatPHP(-dashboard.remainingMinor)}`}</AppText>
              </View>
            ) : (
              <AppText variant="headline" accessibilityLabel={`Remaining ${formatPHP(dashboard.remainingMinor)}`}>
                {formatPHP(dashboard.remainingMinor)}
              </AppText>
            )}
            <View style={styles.tiles}>
              <View style={styles.tile} accessible accessibilityLabel={`Total budget ${formatPHP(dashboard.totalBudgetMinor)}`}>
                <MaterialCommunityIcons name="wallet-outline" size={20} color={colors.primaryLight} aria-hidden />
                <AppText variant="caption" tone="secondary">
                  Budget
                </AppText>
                <AppText variant="bodyStrong">{formatPHP(dashboard.totalBudgetMinor)}</AppText>
              </View>
              <View style={styles.tile} accessible accessibilityLabel={`Spent ${formatPHP(dashboard.spentMinor)}`}>
                <MaterialCommunityIcons name="cash-minus" size={20} color={colors.primaryLight} aria-hidden />
                <AppText variant="caption" tone="secondary">
                  Spent
                </AppText>
                <AppText variant="bodyStrong">{formatPHP(dashboard.spentMinor)}</AppText>
              </View>
            </View>
            {pendingMinor > 0 ? (
              <AppText variant="caption" tone="secondary">
                {`Includes ${formatPHP(pendingMinor)} saved on this phone, not sent yet.`}
              </AppText>
            ) : null}
            <Button label="Add spend" variant="primary" icon="plus" onPress={() => router.push('/add')} />
          </Card>
          <Card>
            <SpendChart categories={dashboard.categories} />
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  overRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  tiles: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap', marginVertical: spacing.sm },
  tile: {
    flexGrow: 1,
    flexBasis: 140,
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radius.button,
    backgroundColor: colors.surfaceRaised,
  },
});
