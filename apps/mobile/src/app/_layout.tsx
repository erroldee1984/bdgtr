import { ClerkProvider } from '@clerk/expo';
import { resourceCache } from '@clerk/expo/resource-cache';
import { tokenCache } from '@clerk/expo/token-cache';
// One file per weight: the package root pulls every weight into the APK.
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Poppins_600SemiBold } from '@expo-google-fonts/poppins/600SemiBold';
import { Poppins_700Bold } from '@expo-google-fonts/poppins/700Bold';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AppText } from '@/components/app-text';
import { HouseholdProvider } from '@/household/household-context';
import { HeaderBackButton } from '@/layout/back-button';
import { PushBridge } from '@/notifications/push-bridge';
import { OutboxProvider } from '@/offline/outbox-context';
import { SkipToContent } from '@/components/skip-to-content';
import { ToastProvider } from '@/toast/toast';
import { CLERK_PUBLISHABLE_KEY } from '@/lib/config';
import { colors, spacing } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Android app: Clerk keeps the signed-in session on the phone, so a fresh
 * start without a connection still restores it and offline mode can open
 * (docs/PLAN.md §15). Clerk marks this experimental. The website stays
 * online-only, so it isn't used there.
 */
const CLERK_RESOURCE_CACHE = Platform.OS === 'web' ? undefined : resourceCache;

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
    // Swipe actions on the Spend list need the gesture-handler root.
    <GestureHandlerRootView style={styles.root}>
      <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache} __experimental_resourceCache={CLERK_RESOURCE_CACHE}>
        <HouseholdProvider>
          <ThemeProvider value={navTheme}>
            <ToastProvider>
              <OutboxProvider>
              <PushBridge />
            <SkipToContent />
              <StatusBar style="light" />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.bg },
                }}
              >
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="sign-in" />
                <Stack.Screen name="onboarding" />
                <Stack.Screen name="invite/[token]" />
                <Stack.Screen
                  name="household"
                  options={{
                    headerShown: true,
                    title: 'Household',
                    headerStyle: { backgroundColor: colors.surface },
                    headerTintColor: colors.textPrimary,
                    // Always a way back, even when the page was opened straight from its URL.
                    headerLeft: () => <HeaderBackButton />,
                  }}
                />
                <Stack.Screen
                  name="settings"
                  options={{
                    headerShown: true,
                    title: 'Settings',
                    headerStyle: { backgroundColor: colors.surface },
                    headerTintColor: colors.textPrimary,
                    headerLeft: () => <HeaderBackButton />,
                  }}
                />
                <Stack.Screen
                  name="categories"
                  options={{
                    headerShown: true,
                    title: 'Categories',
                    headerStyle: { backgroundColor: colors.surface },
                    headerTintColor: colors.textPrimary,
                    headerLeft: () => <HeaderBackButton />,
                  }}
                />
                <Stack.Screen
                  name="budgets/index"
                  options={{
                    headerShown: true,
                    title: 'Budgets',
                    headerStyle: { backgroundColor: colors.surface },
                    headerTintColor: colors.textPrimary,
                    headerLeft: () => <HeaderBackButton />,
                  }}
                />
                <Stack.Screen
                  name="fixed"
                  options={{
                    headerShown: true,
                    title: 'Fixed transactions',
                    headerStyle: { backgroundColor: colors.surface },
                    headerTintColor: colors.textPrimary,
                    headerLeft: () => <HeaderBackButton />,
                  }}
                />
                <Stack.Screen
                  name="budgets/categories"
                  options={{
                    headerShown: true,
                    title: 'Budget per Category',
                    headerStyle: { backgroundColor: colors.surface },
                    headerTintColor: colors.textPrimary,
                    headerLeft: () => <HeaderBackButton />,
                  }}
                />
                <Stack.Screen
                  name="add"
                  options={{
                    presentation: 'modal',
                    headerShown: true,
                    title: 'Add spend',
                    headerStyle: { backgroundColor: colors.surface },
                    headerTintColor: colors.textPrimary,
                    headerLeft: () => <HeaderBackButton />,
                  }}
                />
              </Stack>
              </OutboxProvider>
            </ToastProvider>
          </ThemeProvider>
        </HouseholdProvider>
      </ClerkProvider>
    </GestureHandlerRootView>
  );
}

/** Shown instead of crashing when a build is missing its Clerk key. */
function SignInNotConfigured() {
  return (
    <View style={styles.misconfigured} role="alert">
      <AppText variant="title">Sign-in isn&apos;t configured</AppText>
      <AppText tone="secondary">This build has no Clerk publishable key (EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY).</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  misconfigured: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.xl,
    justifyContent: 'center',
    gap: spacing.sm,
  },
});
