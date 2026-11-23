import { useClerk } from '@clerk/expo';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { AppText } from '@/components/app-text';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

const SECTIONS = [
  'Budgets',
  'Categories',
  'Fixed transactions',
  'Household & members',
  'Settings',
] as const;

export default function MoreScreen() {
  const { signOut } = useClerk();
  const [signingOut, setSigningOut] = useState(false);

  return (
    <Screen title="More">
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
          try {
            await signOut(); // RequireSignIn then redirects to /sign-in
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
});
