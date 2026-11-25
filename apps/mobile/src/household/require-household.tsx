import { Redirect } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

import { useHousehold } from './household-context';
import { readPendingInvite } from './pending-invite';

/** The invite remembered during sign-in: undefined while checking, then the token or null. */
function usePendingInvite(): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void readPendingInvite().then((t) => alive && setToken(t));
    return () => {
      alive = false;
    };
  }, []);
  return token;
}

/**
 * Shows children only once the user's households are loaded and one is active.
 * - An invite opened before signing in → back to that invite first.
 * - No households yet → onboarding ("Create your household").
 */
export function RequireHousehold({ children }: { children: ReactNode }) {
  const { state, active, refresh } = useHousehold();
  const pendingInvite = usePendingInvite();

  if (pendingInvite) return <Redirect href={{ pathname: '/invite/[token]', params: { token: pendingInvite } }} />;

  if (state.status === 'idle' || state.status === 'loading' || pendingInvite === undefined) {
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
