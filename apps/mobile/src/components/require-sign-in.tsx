import { useAuth } from '@clerk/expo';
import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

/**
 * Renders children only for a signed-in user; otherwise sends them to
 * /sign-in. Shows a spinner while Clerk restores the session. This is only a
 * convenience for the UI: the API checks the session token on every request.
 */
export function RequireSignIn({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) {
    return (
      <View style={styles.center} aria-busy>
        <ActivityIndicator color={colors.primaryLight} accessibilityLabel="Loading" />
      </View>
    );
  }
  if (!isSignedIn) return <Redirect href="/sign-in" />;
  return <>{children}</>;
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
});
