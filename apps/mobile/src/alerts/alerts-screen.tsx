import type { Alert } from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { useHousehold } from '@/household/household-context';
import { fixedProblem } from '@/fixed/fixed-screen';
import { bulkPostFixed, fetchAlerts, markAlertsRead } from '@/lib/api';
import { useToast } from '@/toast/toast';
import { colors, spacing } from '@/theme/tokens';

import { useUnreadAlerts } from './unread-alerts';

const WHEN = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });


/**
 * Alerts (docs/PLAN.md §6.10): budget alerts, daily summaries and
 * fixed-transaction notices from the last 7 days (older ones are deleted to
 * save space), newest first, with who triggered each budget alert. A "due
 * today" reminder has "Add it now" while it's still its day and not yet
 * added. Opening the screen marks them read (the tab badge clears); the ones
 * that were new stay marked "New" until you leave.
 */
export function AlertsScreen() {
  const { getToken } = useAuth();
  const { active, memberships, switchTo } = useHousehold();
  const householdId = active?.householdId ?? null;
  // Tapping a notification opens /alerts?household=<id>: show that household's alerts.
  const { household: wanted } = useLocalSearchParams<{ household?: string }>();
  useEffect(() => {
    if (wanted && wanted !== householdId && memberships.some((m) => m.householdId === wanted)) switchTo(wanted);
  }, [wanted, householdId, memberships, switchTo]);
  const unread = useUnreadAlerts();
  const [result, setResult] = useState<{ key: string; alerts: Alert[] | null; error: boolean } | null>(null);
  const key = `${householdId}`;
  const toast = useToast();
  const [adding, setAdding] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  // One clientId per reminder, so a retry after a dropped connection can't add it twice.
  const clientIds = useRef(new Map<string, string>());

  const load = useCallback(() => {
    if (!householdId) return () => {};
    let alive = true;
    fetchAlerts(() => getToken(), householdId)
      .then(async (r) => {
        if (!alive) return;
        setResult({ key: `${householdId}`, alerts: r.alerts, error: false });
        if (r.unreadCount > 0) {
          await markAlertsRead(() => getToken(), householdId).catch(() => {});
          unread.clear();
        }
      })
      .catch(() => alive && setResult({ key: `${householdId}`, alerts: null, error: true }));
    return () => {
      alive = false;
    };
    // `unread` changes when its count does; reloading for that would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken, householdId]);

  useFocusEffect(load);

  const current = result?.key === key ? result : null;

  /** "Add it now" on a due-today reminder: adds the item as a spend on its due day. */
  async function addNow(a: Alert) {
    if (!householdId || !a.fixedTransactionId || !a.dueDate) return;
    const name = a.title.replace(/^Due today · /, '');
    const clientId = clientIds.current.get(a.id) ?? Crypto.randomUUID();
    clientIds.current.set(a.id, clientId);
    setAdding(a.id);
    setMessage(null);
    try {
      const { alerts } = await bulkPostFixed(() => getToken(), householdId, {
        date: a.dueDate,
        items: [{ id: a.fixedTransactionId, clientId }],
      });
      for (const x of alerts) toast.show({ level: x.level, title: x.title, body: x.body });
      setResult((r) => (r?.alerts ? { ...r, alerts: r.alerts.map((x) => (x.id === a.id ? { ...x, canAdd: false } : x)) } : r));
      setMessage({ tone: 'success', text: `${name} added as today's spend.` });
    } catch (err) {
      setMessage({ tone: 'danger', text: fixedProblem(err).replace("Couldn't save", `Couldn't add ${name}`) });
    } finally {
      setAdding(null);
    }
  }

  return (
    <Screen title="Alerts" subtitle="This household's budget alerts, daily summaries and fixed-transaction notices from the last 7 days">

      {message ? (
        <AppText tone={message.tone} role={message.tone === 'danger' ? 'alert' : undefined} aria-live="polite">
          {message.text}
        </AppText>
      ) : null}

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
          <AppText tone="secondary">No alerts in the last 7 days.</AppText>
        </Card>
      ) : (
        current.alerts.map((a) => {
          const over = a.level === 'over';
          const icon =
            a.kind === 'daily_summary'
              ? 'newspaper-variant-outline'
              : a.kind === 'fixed_added'
                ? 'calendar-check'
                : a.kind === 'fixed_due'
                  ? 'calendar-clock'
                  : over
                    ? 'alert'
                    : 'alert-circle-outline';
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
              {a.kind === 'fixed_due' && a.canAdd ? (
                <Button
                  label="Add it now"
                  icon="plus"
                  variant="primary"
                  compact
                  busy={adding === a.id}
                  accessibilityLabel={`Add ${a.title.replace(/^Due today · /, '')} now`}
                  onPress={() => void addNow(a)}
                />
              ) : null}
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
