import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { ApiError, useFetchMe } from '@/lib/api';
import { colors, spacing } from '@/theme/tokens';

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; email: string | null }
  | { kind: 'error'; message: string };

/**
 * Calls GET /me: proves sign-in → API token check → database all work.
 * Icon + text, never colour alone (WCAG 1.4.1); announced politely (4.1.3).
 */
export function AccountStatus() {
  const loadMe = useFetchMe();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    loadMe()
      .then((me) => active && setState({ kind: 'ok', email: me.user.email }))
      .catch((err: unknown) => {
        if (!active) return;
        const message =
          err instanceof ApiError && err.status === 401
            ? 'The server did not accept your sign-in.'
            : err instanceof ApiError && err.status === 503
              ? 'The server is not set up for sign-in yet.'
              : "Couldn't load your account.";
        setState({ kind: 'error', message });
      });
    return () => {
      active = false;
    };
  }, [loadMe]);

  const view =
    state.kind === 'loading'
      ? { icon: 'progress-clock' as const, color: colors.textSecondary, tone: 'secondary' as const, text: 'Loading your account…' }
      : state.kind === 'ok'
        ? { icon: 'account-check' as const, color: colors.success, tone: 'success' as const, text: `Signed in as ${state.email ?? 'your account'}` }
        : { icon: 'alert-circle' as const, color: colors.danger, tone: 'danger' as const, text: state.message };

  return (
    <View style={styles.row} aria-live="polite">
      <MaterialCommunityIcons name={view.icon} size={22} color={view.color} aria-hidden />
      <AppText variant="bodyStrong" tone={view.tone} style={styles.flex}>
        {view.text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flexShrink: 1 },
});
