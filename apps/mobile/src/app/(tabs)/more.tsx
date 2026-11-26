import { useAuth, useClerk } from '@clerk/expo';
import { router } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Screen } from '@/components/screen';
import { SetupCheck } from '@/components/setup-check';
import { clearAllPins } from '@/breakdown/pins';
import { Button } from '@/components/button';
import { Dialog } from '@/components/dialog';
import { forgetPushOnSignOut } from '@/notifications/device-push';
import { useOutbox } from '@/offline/outbox-context';
import { vaultClear } from '@/offline/vault';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

export default function MoreScreen() {
  const { signOut } = useClerk();
  const { getToken } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const [confirmUnsent, setConfirmUnsent] = useState(false);
  const unsent = useOutbox().items.length;

  async function doSignOut() {
    setConfirmUnsent(false);
    setSigningOut(true);
    setSignOutError(false);
    try {
      // Stop this browser getting this account's alerts (shared computers).
      await forgetPushOnSignOut(() => getToken());
      await clearAllPins(); // pins stay on a device only while signed in (PLAN §6.8)
      await vaultClear(); // offline copies and unsent spends (PLAN §15)
      await signOut(); // RequireSignIn then redirects to /sign-in
    } catch {
      setSignOutError(true);
    } finally {
      setSigningOut(false);
    }
  }

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
        accessibilityLabel="Budgets"
        onPress={() => router.push('/budgets')}
        style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]}
      >
        <MaterialCommunityIcons name="wallet-outline" size={24} color={colors.primaryLight} aria-hidden />
        <View style={styles.flex}>
          <AppText variant="bodyStrong">Budgets</AppText>
          <AppText variant="caption" tone="secondary">
            Monthly budget and how it&apos;s split across categories
          </AppText>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textSecondary} aria-hidden />
      </Pressable>
      <Pressable
        role="link"
        accessibilityLabel="Fixed transactions"
        onPress={() => router.push('/fixed')}
        style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]}
      >
        <MaterialCommunityIcons name="calendar-sync-outline" size={24} color={colors.primaryLight} aria-hidden />
        <View style={styles.flex}>
          <AppText variant="bodyStrong">Fixed transactions</AppText>
          <AppText variant="caption" tone="secondary">
            Rent, bills and other monthly spends, added automatically
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
      <Pressable
        role="button"
        accessibilityState={{ busy: signingOut, disabled: signingOut }}
        disabled={signingOut}
        onPress={() => (unsent > 0 ? setConfirmUnsent(true) : void doSignOut())}
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
      {confirmUnsent ? (
        <Dialog
          visible
          title={`${unsent} ${unsent === 1 ? 'spend hasn’t' : 'spends haven’t'} been sent`}
          onClose={() => setConfirmUnsent(false)}
          actions={
            <>
              <Button label="Cancel" compact onPress={() => setConfirmUnsent(false)} />
              <Button label="Sign out anyway" variant="danger" compact onPress={() => void doSignOut()} />
            </>
          }
        >
          <AppText tone="secondary">
            They were saved on this phone while offline. If you sign out now they&apos;ll be lost. Go online and let them send first.
          </AppText>
        </Dialog>
      ) : null}
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
