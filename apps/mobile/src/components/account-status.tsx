import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { ApiError, useFetchMe } from '@/lib/api';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; email: string | null }
  | { kind: 'error'; message: string; detail: string };

/** User-facing message plus a short technical reason (shown in development only). */
export function describeAccountError(err: unknown): { message: string; detail: string } {
  if (err instanceof ApiError) {
    if (err.status === 401) return { message: 'The server did not accept your sign-in.', detail: `401 ${err.code}` };
    if (err.status === 503) return { message: 'The server is not set up for sign-in yet.', detail: `503 ${err.code}` };
    return { message: "Couldn't load your account.", detail: `${err.status} ${err.code}` };
  }
  if (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'ZodError') {
    return { message: "Couldn't load your account.", detail: 'unexpected response shape' };
  }
  return { message: "Couldn't reach the server to load your account.", detail: 'network' };
}

/**
 * Calls GET /me: proves sign-in → API token check → database all work.
 * Network failures are retried automatically (see withNetworkRetry); a
 * "Try again" button covers anything else. Icon + text, never colour alone
 * (WCAG 1.4.1); announced politely (4.1.3).
 */
export function AccountStatus() {
  const loadMe = useFetchMe();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    loadMe()
      .then((me) => active && setState({ kind: 'ok', email: me.user.email }))
      .catch((err: unknown) => {
        if (!active) return;
        if (__DEV__) console.warn('[account] /me failed', err);
        setState({ kind: 'error', ...describeAccountError(err) });
      });
    return () => {
      active = false;
    };
  }, [loadMe, attempt]);

  const retry = useCallback(() => {
    setState({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  const view =
    state.kind === 'loading'
      ? { icon: 'progress-clock' as const, color: colors.textSecondary, tone: 'secondary' as const, text: 'Loading your account…' }
      : state.kind === 'ok'
        ? { icon: 'account-check' as const, color: colors.success, tone: 'success' as const, text: `Signed in as ${state.email ?? 'your account'}` }
        : { icon: 'alert-circle' as const, color: colors.danger, tone: 'danger' as const, text: state.message };

  return (
    <View style={styles.wrap}>
      <View style={styles.row} aria-live="polite">
        <MaterialCommunityIcons name={view.icon} size={22} color={view.color} aria-hidden />
        <AppText variant="bodyStrong" tone={view.tone} style={styles.flex}>
          {view.text}
        </AppText>
      </View>
      {state.kind === 'error' ? (
        <>
          {__DEV__ ? (
            <AppText variant="caption" tone="secondary">
              Reason: {state.detail}
            </AppText>
          ) : null}
          <Pressable
            role="button"
            accessibilityLabel="Try loading your account again"
            onPress={retry}
            style={({ pressed }) => [styles.retry, pressed && { opacity: 0.75 }]}
          >
            <AppText variant="bodyStrong" style={{ color: colors.onPrimary }}>
              Try again
            </AppText>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flexShrink: 1 },
  retry: {
    alignSelf: 'flex-start',
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.button,
    backgroundColor: colors.primary,
  },
});
