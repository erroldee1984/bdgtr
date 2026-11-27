import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { colors, radius, spacing } from '@/theme/tokens';

import { useOutbox } from './outbox-context';

/** "You're offline. 2 spends will be sent when you're back online." */
export function bannerText(offline: boolean, waiting: number): string | null {
  const spends = `${waiting} ${waiting === 1 ? 'spend' : 'spends'}`;
  if (offline && waiting) return `You're offline. ${spends} will be sent when you're back online.`;
  if (offline) return "You're offline. Spends you add are saved on this phone and sent later.";
  if (waiting) return `${spends} waiting to be sent.`;
  return null;
}

/**
 * Top-of-screen offline notice (docs/PLAN.md §15), Android app only. Never
 * covers the add button or tabs (it's part of the page). Announced politely.
 */
export function OfflineBanner() {
  const { items, offline, syncNow } = useOutbox();
  const waiting = items.filter((i) => i.state === 'pending').length;
  const text = bannerText(offline, waiting);
  if (!text) return null;
  return (
    <View style={styles.banner} role="status" aria-live="polite" testID="offline-banner">
      <MaterialCommunityIcons name={offline ? 'cloud-off-outline' : 'cloud-upload-outline'} size={20} color={colors.textPrimary} aria-hidden />
      <AppText style={styles.flex}>{text}</AppText>
      {waiting ? <Button label="Send now" compact onPress={syncNow} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  flex: { flex: 1, minWidth: 160 },
});
