import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { Poppins_600SemiBold, Poppins_700Bold } from '@expo-google-fonts/poppins';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { CLERK_PUBLISHABLE_KEY } from '@/lib/config';
import { colors, spacing } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.bg,
    card: colors.surface,
    text: colors.textPrimary,
    border: colors.border,
    notification: colors.danger,
  },
};

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Poppins_600SemiBold,
    Poppins_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  const ready = fontsLoaded || !!fontError; // if fonts fail, fall back to system fonts rather than hang

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  if (!CLERK_PUBLISHABLE_KEY) return <SignInNotConfigured />;

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <ThemeProvider value={navTheme}>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="sign-in" />
          <Stack.Screen
            name="add"
            options={{
              presentation: 'modal',
              headerShown: true,
              title: 'Add spend',
              headerStyle: { backgroundColor: colors.surface },
              headerTintColor: colors.textPrimary,
            }}
          />
        </Stack>
      </ThemeProvider>
    </ClerkProvider>
  );
}

/** Shown instead of crashing when a build is missing its Clerk key. */
function SignInNotConfigured() {
  return (
    <View style={styles.misconfigured} role="alert">
      <AppText variant="title">Sign-in isn&apos;t configured</AppText>
      <AppText tone="secondary">
        This build has no Clerk publishable key (EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY).
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  misconfigured: { flex: 1, backgroundColor: colors.bg, padding: spacing.xl, justifyContent: 'center', gap: spacing.sm },
});
