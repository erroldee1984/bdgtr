import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { colors, spacing } from '@/theme/tokens';

const TIME = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
const DAY = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', timeZone: 'Asia/Manila' });

/** "Showing data saved at 7:42 AM today" / "… on Nov 26, 7:42 AM" (Manila time). */
export function savedAtText(savedAt: string, now: Date = new Date()): string {
  const at = new Date(savedAt);
  const sameDay = DAY.format(at) === DAY.format(now);
  return sameDay ? `Showing data saved at ${TIME.format(at)} today` : `Showing data saved on ${DAY.format(at)}, ${TIME.format(at)}`;
}

/** Shown on a screen while it's displaying the copy saved on the phone (offline). */
export function CachedNotice({ cachedAt }: { cachedAt: string | null }) {
  if (!cachedAt) return null;
  return (
    <View style={styles.row} role="status" testID="cached-notice">
      <MaterialCommunityIcons name="history" size={18} color={colors.textSecondary} aria-hidden />
      <AppText variant="caption" tone="secondary" style={styles.flex}>
        {`${savedAtText(cachedAt)}. It updates when you're back online.`}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
});
