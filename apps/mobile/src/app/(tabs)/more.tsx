import { useAuth, useClerk } from '@clerk/expo';
import { router } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { type ComponentProps, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Screen } from '@/components/screen';
import { clearAllPins } from '@/breakdown/pins';
import { Button } from '@/components/button';
import { Dialog } from '@/components/dialog';
import { useHousehold } from '@/household/household-context';
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
  const { items, offline } = useOutbox();
  const { state } = useHousehold();
  const email = state.status === 'ready' ? state.me.user.email : null;
  const unsent = items.length;

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
      <LinkCard
        icon="home-group"
        title="Household & members"
        label="Household and members"
        detail="Name, budget, members and invites"
        href="/household"
        disabled={offline}
      />
      <LinkCard
        icon="shape-outline"
        title="Categories"
        label="Categories"
        detail="Names, icons, colours and default budgets"
        href="/categories"
        disabled={offline}
      />
      <LinkCard
        icon="wallet-outline"
        title="Budgets"
        label="Budgets"
        detail="Monthly budget and how it’s split across categories"
        href="/budgets"
      />
      <LinkCard
        icon="calendar-sync-outline"
        title="Fixed transactions"
        label="Fixed transactions"
        detail="Rent, bills and other monthly spends, added automatically"
        href="/fixed"
        disabled={offline}
      />
      <LinkCard
        icon="bell-cog-outline"
        title="Settings"
        label="Settings"
        detail="Notifications, muting and your devices"
        href="/settings"
        disabled={offline}
      />
      {email ? <AppText variant="caption" tone="secondary">{`Signed in as ${email}`}</AppText> : null}
      <Pressable
        role="button"
        accessibilityState={{ busy: signingOut, disabled: signingOut || offline }}
        accessibilityHint={offline ? 'Needs a connection' : undefined}
        disabled={signingOut || offline}
        onPress={() => (unsent > 0 ? setConfirmUnsent(true) : void doSignOut())}
        style={({ pressed }) => [styles.signOut, (pressed || signingOut) && styles.pressed]}
      >
        <MaterialCommunityIcons name="logout" size={22} color={colors.danger} aria-hidden />
        <AppText variant="bodyStrong" tone="danger">
          {signingOut ? 'Signing out…' : offline ? 'Sign out (needs a connection)' : 'Sign out'}
        </AppText>
      </Pressable>
      {signOutError ? (
        <AppText tone="danger" role="alert">
          Couldn&apos;t sign out. Check your connection and try again.
        </AppText>
      ) : null}
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

/**
 * A row linking to another screen. Online-only screens are disabled while the
 * phone is offline (docs/PLAN.md §15) and say why in words, not only by fading.
 */
function LinkCard({
  icon,
  title,
  label,
  detail,
  href,
  disabled = false,
}: {
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  label: string;
  detail: string;
  href: '/household' | '/categories' | '/budgets' | '/fixed' | '/settings';
  disabled?: boolean;
}) {
  return (
    <Pressable
      role="link"
      accessibilityLabel={label}
      accessibilityHint={disabled ? 'Needs a connection' : undefined}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => router.push(href)}
      style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]}
    >
      <MaterialCommunityIcons name={icon} size={24} color={disabled ? colors.textSecondary : colors.primaryLight} aria-hidden />
      <View style={styles.flex}>
        <AppText variant="bodyStrong" tone={disabled ? 'secondary' : undefined}>
          {title}
        </AppText>
        <AppText variant="caption" tone="secondary">
          {disabled ? 'Needs a connection' : detail}
        </AppText>
      </View>
      {disabled ? (
        <MaterialCommunityIcons name="wifi-off" size={22} color={colors.textSecondary} aria-hidden />
      ) : (
        <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textSecondary} aria-hidden />
      )}
    </Pressable>
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
