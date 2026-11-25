import { useAuth, useSSO } from '@clerk/expo';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as AuthSession from 'expo-auth-session';
import { Redirect, router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { WelcomeHero } from '@/components/welcome-hero';
import { signInErrorMessage } from '@/lib/sign-in-error';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

// Lets the browser tab hand the OAuth result back to the app and close itself.
WebBrowser.maybeCompleteAuthSession();

/** Opening the Custom Tab is noticeably faster on Android when the browser is pre-warmed. */
function useWarmUpBrowser() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
}

/**
 * Android / Expo Go sign-in with Google via Clerk's OAuth flow (useSSO).
 *
 * Google → Clerk → server-side redirect to the app's return link, which the
 * browser tab watches for and closes on. (Clerk's hosted Account Portal flow
 * was tried first, but it switches back to the app with a script, which Chrome
 * on Android blocked, leaving users on "tap Continue".)
 *
 * Return link: Expo Go → exp://…/--/sso-callback; installed app → bdgtr://sso-callback.
 * The web version is sign-in.web.tsx.
 */
export default function SignInScreen() {
  useWarmUpBrowser();
  const { isLoaded, isSignedIn } = useAuth();
  const { startSSOFlow } = useSSO();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isLoaded && isSignedIn) return <Redirect href="/" />;

  async function signInWithGoogle() {
    setBusy(true);
    setError(null);
    const redirectUrl = AuthSession.makeRedirectUri({ path: 'sso-callback' });
    if (__DEV__) console.log(`[sign-in] Google OAuth, return link: ${redirectUrl}`);
    try {
      const { createdSessionId, setActive, authSessionResult } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl,
      });
      if (__DEV__) console.log(`[sign-in] browser result: ${authSessionResult?.type ?? 'none'}`);
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        router.replace('/');
      }
      // No session = the user closed the tab or cancelled: stay here, no error.
    } catch (err) {
      if (__DEV__) console.warn('[sign-in] failed', err);
      setError(signInErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <WelcomeHero>
      <Pressable
        role="button"
        accessibilityLabel="Continue with Google"
        accessibilityState={{ busy, disabled: busy || !isLoaded }}
        disabled={busy || !isLoaded}
        onPress={signInWithGoogle}
        style={({ pressed }) => [styles.primary, (pressed || busy) && styles.pressed]}
      >
        {busy ? (
          <ActivityIndicator color={colors.onPrimary} />
        ) : (
          <>
            <MaterialCommunityIcons name="google" size={22} color={colors.onPrimary} aria-hidden />
            <AppText variant="bodyStrong" style={{ color: colors.onPrimary }}>
              Continue with Google
            </AppText>
          </>
        )}
      </Pressable>
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
    flexDirection: 'row',
    gap: spacing.sm,
    borderRadius: radius.button,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  pressed: { opacity: 0.8 },
  errorRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  flex: { flex: 1 },
});
