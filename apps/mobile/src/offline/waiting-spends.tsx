import { type Category, formatPHP } from '@bdgtr/shared';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { shortDate } from '@/breakdown/breakdown-row';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { colors, radius, spacing } from '@/theme/tokens';

import type { OutboxItem } from './outbox';
import { useOutbox } from './outbox-context';

function PendingBadge({ label }: { label: string }) {
  return (
    <View style={styles.badge}>
      <MaterialCommunityIcons name="clock-outline" size={14} color={colors.primaryLight} aria-hidden />
      <AppText variant="caption" style={styles.badgeText}>
        {label}
      </AppText>
    </View>
  );
}

const line = (i: OutboxItem, categories: Category[]) =>
  `${shortDate(i.input.date)} · ${categories.find((c) => c.id === i.input.categoryId)?.name ?? 'Unknown category'} · ${formatPHP(i.input.amountMinor)}`;

/** Spend tab: this household's spends saved offline for `month`, not sent yet (icon + "Pending" text, not colour alone). */
export function WaitingSpends({ householdId, month, categories }: { householdId: string; month: string; categories: Category[] }) {
  const { items } = useOutbox();
  const mine = items.filter((i) => i.householdId === householdId && i.input.date.startsWith(month));
  if (mine.length === 0) return null;
  return (
    <Card>
      <AppText variant="bodyStrong" role="heading">
        Waiting to be sent
      </AppText>
      {mine.map((i) => (
        <View key={i.clientId} style={styles.row} accessible accessibilityLabel={`${line(i, categories)}, ${i.state === 'pending' ? 'pending' : 'needs attention'}`}>
          <AppText style={styles.flex}>{line(i, categories)}</AppText>
          <PendingBadge label={i.state === 'pending' ? 'Pending' : 'Needs attention'} />
        </View>
      ))}
      <AppText variant="caption" tone="secondary">
        Saved on this phone while offline. They&apos;re added to the totals once sent.
      </AppText>
    </Card>
  );
}

/** Alerts tab: spends the server refused, with why, and Retry or Discard. */
export function NeedsAttention({ householdId }: { householdId: string }) {
  const { items, retry, discard } = useOutbox();
  const stuck = items.filter((i) => i.householdId === householdId && i.state === 'needs_attention');
  if (stuck.length === 0) return null;
  return (
    <Card>
      <View style={styles.titleRow}>
        <MaterialCommunityIcons name="alert-circle-outline" size={22} color={colors.danger} aria-hidden />
        <AppText variant="bodyStrong" tone="danger" role="heading">
          Needs attention
        </AppText>
      </View>
      {stuck.map((i) => (
        <View key={i.clientId} style={styles.stuck}>
          <AppText variant="bodyStrong">{`${shortDate(i.input.date)} · ${formatPHP(i.input.amountMinor)}`}</AppText>
          <AppText tone="secondary">{i.problem ?? "It couldn't be sent."}</AppText>
          <View style={styles.actions}>
            <Button label="Retry" icon="refresh" compact accessibilityLabel={`Retry the ${formatPHP(i.input.amountMinor)} spend`} onPress={() => retry(i.clientId)} />
            <Button
              label="Discard"
              icon="trash-can-outline"
              variant="danger"
              compact
              accessibilityLabel={`Discard the ${formatPHP(i.input.amountMinor)} spend`}
              onPress={() => discard(i.clientId)}
            />
          </View>
        </View>
      ))}
      <AppText variant="caption" tone="secondary">
        Saved on this phone while offline, but the server didn&apos;t accept them.
      </AppText>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stuck: { gap: spacing.xs, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.primaryLight,
  },
  badgeText: { color: colors.primaryLight },
});
