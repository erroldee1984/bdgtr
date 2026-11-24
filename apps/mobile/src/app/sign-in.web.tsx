import { useAuth } from '@clerk/expo';
import { SignIn } from '@clerk/expo/web';
import { Redirect } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { WelcomeHero } from '@/components/welcome-hero';
import { useHydrated } from '@/layout/use-hydrated';
import { colors } from '@/theme/tokens';

/**
 * Website sign-in: Clerk's own sign-in form (Google + email), styled to the
 * app's dark theme. Hash routing keeps every step on /sign-in, which suits the
 * static site. Android uses sign-in.tsx (hosted page in a browser tab).
 */
export default function SignInScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  const hydrated = useHydrated(); // Clerk's form only exists in the browser

  if (isLoaded && isSignedIn) return <Redirect href="/" />;

  return (
    <WelcomeHero placement="center">
      <View style={styles.form}>
        {hydrated ? (
          <SignIn
            routing="hash"
            fallbackRedirectUrl="/"
            signUpFallbackRedirectUrl="/"
            appearance={{
              variables: {
                colorPrimary: colors.primary,
                colorPrimaryForeground: colors.onPrimary,
                colorBackground: colors.surface,
                colorForeground: colors.textPrimary,
                colorMutedForeground: colors.textSecondary,
                colorInput: colors.surfaceRaised,
                colorInputForeground: colors.textPrimary,
                colorDanger: colors.danger,
                borderRadius: '12px',
                fontFamily: 'Inter_400Regular, system-ui, sans-serif',
              },
            }}
          />
        ) : null}
      </View>
    </WelcomeHero>
  );
}

const styles = StyleSheet.create({
  form: { alignItems: 'center' },
});
