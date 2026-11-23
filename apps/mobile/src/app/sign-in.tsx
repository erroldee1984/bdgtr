import { useAuth } from '@clerk/expo';
import { useHostedAuth } from '@clerk/expo/hosted-auth';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { WelcomeHero } from '@/components/welcome-hero';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

/**
 * Android / Expo Go sign-in: Clerk's hosted page opens in a browser tab
 * (Google blocks sign-in inside in-app web views) and returns to the app.
 * Works in Expo Go; no native Google SDK or dev build needed.
 * The web version is sign-in.web.tsx.
 */
export default function SignInScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  const { startHostedAuth } = useHostedAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoaded && isSignedIn) return <Redirect href="/" />;

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const { createdSessionId } = await startHostedAuth();
      if (createdSessionId) router.replace('/');
      // null = the user closed the browser tab: just stay here, no error.
    } catch {
      setError("Sign-in didn't complete. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <WelcomeHero>
      <Pressable
        role="button"
        accessibilityLabel="Get started: sign in or create an account"
        accessibilityState={{ busy, disabled: busy || !isLoaded }}
        disabled={busy || !isLoaded}
        onPress={signIn}
        style={({ pressed }) => [styles.primary, (pressed || busy) && styles.pressed]}
      >
        {busy ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <AppText variant="bodyStrong" style={{ color: colors.onPrimary }}>
            Get Started
          </AppText>
        )}
      </Pressable>
      <AppText variant="caption" tone="secondary" style={styles.center}>
        Continue with Google or email on the next screen.
      </AppText>
      {error ? (
        <View style={styles.errorRow} role="alert">
          <MaterialCommunityIcons name="alert-circle" size={20} color={colors.danger} aria-hidden />
          <AppText tone="danger" style={styles.flex}>
            {error}
          </AppText>
        </View>
      ) : null}
    </WelcomeHero>
  );
}

const styles = StyleSheet.create({
  primary: {
    minHeight: MIN_TOUCH + 8,
    borderRadius: radius.button,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  pressed: { opacity: 0.8 },
  center: { textAlign: 'center' },
  errorRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  flex: { flex: 1 },
});
