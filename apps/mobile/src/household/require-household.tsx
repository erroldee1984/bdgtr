import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

import { useHousehold } from './household-context';

/**
 * Shows children only once the user's households are loaded and one is active.
 * No households yet → onboarding ("Create your household").
 */
export function RequireHousehold({ children }: { children: ReactNode }) {
  const { state, active, refresh } = useHousehold();

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <View style={styles.center} aria-busy>
        <ActivityIndicator color={colors.primaryLight} accessibilityLabel="Loading your household" />
      </View>
    );
  }
  if (state.status === 'error') {
    return (
      <View style={styles.center} role="alert">
        <AppText variant="title">Couldn&apos;t load your household</AppText>
        <AppText tone="secondary">Check your connection and try again.</AppText>
        <Pressable
          role="button"
          onPress={() => void refresh()}
          style={({ pressed }) => [styles.retry, pressed && { opacity: 0.75 }]}
        >
          <AppText variant="bodyStrong" style={{ color: colors.onPrimary }}>
            Try again
          </AppText>
        </Pressable>
      </View>
    );
  }
  if (!active) return <Redirect href="/onboarding" />;
  return <>{children}</>;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  retry: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.button,
    backgroundColor: colors.primary,
  },
});
