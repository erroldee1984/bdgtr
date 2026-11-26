import { type Alert, manilaDate, yearMonthOf } from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { MonthSwitcher } from '@/components/month-switcher';
import { Screen } from '@/components/screen';
import { useHousehold } from '@/household/household-context';
import { fetchAlerts, markAlertsRead } from '@/lib/api';
import { colors, spacing } from '@/theme/tokens';

import { useUnreadAlerts } from './unread-alerts';

const WHEN = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });

/** "2026-11" ± n months. */
export { shiftMonth } from '@/components/month-switcher';

/**
 * Alerts (docs/PLAN.md §6.10): the month's budget alerts, newest first, with
 * who triggered each one. Opening the screen marks them read (the tab badge
 * clears); the ones that were new stay marked "New" until you leave.
 */
export function AlertsScreen({ now = () => new Date() }: { now?: () => Date }) {
  const { getToken } = useAuth();
  const { active, memberships, switchTo } = useHousehold();
  const householdId = active?.householdId ?? null;
  // Tapping a notification opens /alerts?household=<id>: show that household's alerts.
  const { household: wanted } = useLocalSearchParams<{ household?: string }>();
  useEffect(() => {
    if (wanted && wanted !== householdId && memberships.some((m) => m.householdId === wanted)) switchTo(wanted);
  }, [wanted, householdId, memberships, switchTo]);
  const unread = useUnreadAlerts();
  const thisMonth = yearMonthOf(manilaDate(now()));
  const [month, setMonth] = useState(thisMonth);
  const [result, setResult] = useState<{ key: string; alerts: Alert[] | null; error: boolean } | null>(null);
  const key = `${householdId}:${month}`;

  const load = useCallback(() => {
    if (!householdId) return () => {};
    let alive = true;
    fetchAlerts(() => getToken(), householdId, month)
      .then(async (r) => {
        if (!alive) return;
        setResult({ key: `${householdId}:${month}`, alerts: r.alerts, error: false });
        if (r.unreadCount > 0) {
          await markAlertsRead(() => getToken(), householdId).catch(() => {});
          unread.clear();
        }
      })
      .catch(() => alive && setResult({ key: `${householdId}:${month}`, alerts: null, error: true }));
    return () => {
      alive = false;
    };
    // `unread` changes when its count does; reloading for that would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken, householdId, month]);

  useFocusEffect(load);

  const current = result?.key === key ? result : null;

  return (
    <Screen title="Alerts" subtitle="Budget alerts and fixed-transaction notices for this household">
      <MonthSwitcher month={month} onChange={setMonth} max={thisMonth} />

      {current?.error ? (
        <Card>
          <AppText tone="danger" role="alert">
            Couldn&apos;t load the alerts.
          </AppText>
          <Button label="Try again" compact onPress={() => void load()} />
        </Card>
      ) : !current?.alerts ? (
        <ActivityIndicator color={colors.primaryLight} accessibilityLabel="Loading alerts" />
      ) : current.alerts.length === 0 ? (
        <Card>
          <AppText tone="secondary">No alerts this month.</AppText>
        </Card>
      ) : (
        current.alerts.map((a) => {
          const over = a.level === 'over';
          const icon = a.kind === 'fixed_added' ? 'calendar-check' : a.kind === 'fixed_due' ? 'calendar-clock' : over ? 'alert' : 'alert-circle-outline';
          return (
            <Card key={a.id} testID="alert-row">
              <View style={styles.titleRow}>
                <MaterialCommunityIcons name={icon} size={22} color={over ? colors.danger : colors.primaryLight} aria-hidden />
                <AppText variant="bodyStrong" tone={over ? 'danger' : 'primary'} style={styles.flex}>
                  {a.title}
                </AppText>
                {a.unread ? (
                  <View style={styles.newBadge}>
                    <AppText variant="caption" style={{ color: colors.onPrimary }}>
                      New
                    </AppText>
                  </View>
                ) : null}
              </View>
              <AppText>{a.body}</AppText>
              <AppText variant="caption" tone="secondary">
                {`${WHEN.format(new Date(a.createdAt))}${a.triggeredBy ? ` · after a spend by ${a.triggeredBy}` : ''}`}
              </AppText>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  newBadge: { backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 2 },
});
