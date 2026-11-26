import { useAuth, useClerk } from '@clerk/expo';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { SetupCheck } from '@/components/setup-check';
import { forgetPushOnSignOut } from '@/notifications/device-push';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

const SECTIONS = ['Budgets', 'Fixed transactions'] as const;

export default function MoreScreen() {
  const { signOut } = useClerk();
  const { getToken } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);

  return (
    <Screen title="More">
      <Pressable
        role="link"
        accessibilityLabel="Household and members"
        onPress={() => router.push('/household')}
        style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]}
      >
        <MaterialCommunityIcons name="home-group" size={24} color={colors.primaryLight} aria-hidden />
        <View style={styles.flex}>
          <AppText variant="bodyStrong">Household & members</AppText>
          <AppText variant="caption" tone="secondary">
            Name, budget, members and invites
          </AppText>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textSecondary} aria-hidden />
      </Pressable>
      <Pressable
        role="link"
        accessibilityLabel="Categories"
        onPress={() => router.push('/categories')}
        style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]}
      >
        <MaterialCommunityIcons name="shape-outline" size={24} color={colors.primaryLight} aria-hidden />
        <View style={styles.flex}>
          <AppText variant="bodyStrong">Categories</AppText>
          <AppText variant="caption" tone="secondary">
            Names, icons, colours and default budgets
          </AppText>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textSecondary} aria-hidden />
      </Pressable>
      <Pressable
        role="link"
        accessibilityLabel="Settings"
        onPress={() => router.push('/settings')}
        style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]}
      >
        <MaterialCommunityIcons name="bell-cog-outline" size={24} color={colors.primaryLight} aria-hidden />
        <View style={styles.flex}>
          <AppText variant="bodyStrong">Settings</AppText>
          <AppText variant="caption" tone="secondary">
            Notifications, muting and your devices
          </AppText>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textSecondary} aria-hidden />
      </Pressable>
      {SECTIONS.map((section) => (
        <Card key={section}>
          <AppText variant="bodyStrong">{section}</AppText>
          <AppText variant="caption" tone="secondary">
            Coming in a later milestone
          </AppText>
        </Card>
      ))}
      <Pressable
        role="button"
        accessibilityState={{ busy: signingOut, disabled: signingOut }}
        disabled={signingOut}
        onPress={async () => {
          setSigningOut(true);
          setSignOutError(false);
          try {
            // Stop this browser getting this account's alerts (shared computers).
            await forgetPushOnSignOut(() => getToken());
            await signOut(); // RequireSignIn then redirects to /sign-in
          } catch {
            setSignOutError(true);
          } finally {
            setSigningOut(false);
          }
        }}
        style={({ pressed }) => [styles.signOut, (pressed || signingOut) && styles.pressed]}
      >
        <MaterialCommunityIcons name="logout" size={22} color={colors.danger} aria-hidden />
        <AppText variant="bodyStrong" tone="danger">
          {signingOut ? 'Signing out…' : 'Sign out'}
        </AppText>
      </Pressable>
      {signOutError ? (
        <AppText tone="danger" role="alert">
          Couldn&apos;t sign out. Check your connection and try again.
        </AppText>
      ) : null}
      <SetupCheck />
    </Screen>
  );
}

const styles = StyleSheet.create({
  signOut: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.danger,
    alignSelf: 'flex-start',
  },
  pressed: { opacity: 0.75 },
  flex: { flex: 1 },
  linkCard: {
    minHeight: MIN_TOUCH + 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
  },
});
