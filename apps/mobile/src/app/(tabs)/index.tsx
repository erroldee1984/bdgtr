import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { AccountStatus } from '@/components/account-status';
import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { type ApiStatus, checkApiHealthWithRetry } from '@/lib/api-health';
import { useHydrated } from '@/layout/use-hydrated';
import { usesNavRail, windowClassFor } from '@/layout/window-class';
import { API_URL } from '@/lib/config';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

const STATUS_COPY: Record<ApiStatus | 'checking', { text: string; icon: 'check-circle' | 'alert-circle' | 'progress-clock'; tone: 'success' | 'danger' | 'secondary' }> = {
  checking: { text: 'Checking connection…', icon: 'progress-clock', tone: 'secondary' },
  connected: { text: 'Connected to the bdgtr server', icon: 'check-circle', tone: 'success' },
  unreachable: { text: "Can't reach the bdgtr server", icon: 'alert-circle', tone: 'danger' },
  unexpected_response: { text: 'The server answered unexpectedly', icon: 'alert-circle', tone: 'danger' },
};

export default function DashboardScreen() {
  const [status, setStatus] = useState<ApiStatus | 'checking'>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void checkApiHealthWithRetry(API_URL).then((result) => {
      if (active) setStatus(result); // ignore results after unmount / a newer retry
    });
    return () => {
      active = false;
    };
  }, [attempt]);

  const check = useCallback(() => {
    setStatus('checking');
    setAttempt((n) => n + 1);
  }, []);

  // Live screen size: helps confirm the layout on foldables (updates on fold/unfold).
  const { width, height } = useWindowDimensions();
  const windowClass = windowClassFor(width);
  const hydrated = useHydrated(); // size isn't known in the pre-built web HTML

  const copy = STATUS_COPY[status];
  const iconColor =
    copy.tone === 'success' ? colors.success : copy.tone === 'danger' ? colors.danger : colors.textSecondary;

  return (
    <Screen title="Hi there!" subtitle="Your household dashboard arrives in milestone M2.">
      <Card>
        <AppText variant="title">Setup check</AppText>
        <AccountStatus />
        {/* Icon + text, never colour alone (WCAG 1.4.1). Announced when it changes (4.1.3). */}
        <View style={styles.statusRow} aria-live="polite">
          <MaterialCommunityIcons name={copy.icon} size={22} color={iconColor} aria-hidden />
          <AppText variant="bodyStrong" tone={copy.tone}>
            {copy.text}
          </AppText>
        </View>
        <AppText variant="caption" tone="secondary" selectable>
          {API_URL}
        </AppText>
        {hydrated ? (
          <AppText variant="caption" tone="secondary">
            {`Screen ${Math.round(width)} × ${Math.round(height)} dp · ${windowClass} layout · ${usesNavRail(windowClass) ? 'side menu' : 'bottom bar'}`}
          </AppText>
        ) : null}
        {status !== 'checking' && status !== 'connected' ? (
          <Pressable
            role="button"
            onPress={check}
            style={({ pressed }) => [styles.retry, pressed && { opacity: 0.75 }]}
          >
            <AppText variant="bodyStrong" style={{ color: colors.onPrimary }}>
              Try again
            </AppText>
          </Pressable>
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  retry: {
    alignSelf: 'flex-start',
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.button,
    backgroundColor: colors.primary,
    marginTop: spacing.sm,
  },
});
