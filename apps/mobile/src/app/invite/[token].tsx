import { INVITE_TOKEN_PATTERN } from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { WelcomeHero } from '@/components/welcome-hero';
import { useHousehold } from '@/household/household-context';
import { clearPendingInvite, rememberPendingInvite } from '@/household/pending-invite';
import { acceptErrorMessage } from '@/household/invite-errors';
import { acceptInvite } from '@/lib/api';
import { colors, spacing } from '@/theme/tokens';

/**
 * /invite/<token>: opened from a shared link (the Android app through App
 * Links, otherwise the website). Signed out: remember the invite and sign in
 * first. Signed in: accept on a button press (never just by visiting).
 */
export default function InviteScreen() {
  const { token: raw } = useLocalSearchParams<{ token: string }>();
  const token = typeof raw === 'string' ? raw : '';
  const valid = INVITE_TOKEN_PATTERN.test(token);
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { refresh } = useHousehold();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; final: boolean } | null>(null);

  useEffect(() => {
    if (isLoaded && !isSignedIn && valid) void rememberPendingInvite(token);
  }, [isLoaded, isSignedIn, valid, token]);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const joined = await acceptInvite(() => getToken(), token);
      await clearPendingInvite();
      await refresh(joined.householdId); // and make it the active household
      router.replace('/');
    } catch (err) {
      const e = acceptErrorMessage(err);
      if (e.final) await clearPendingInvite();
      setError(e);
      setBusy(false);
    }
  }

  async function dismiss() {
    await clearPendingInvite();
    router.replace('/');
  }

  let body;
  if (!valid) {
    body = (
      <AppText tone="danger" role="alert">
        This invite link isn&apos;t valid. Check it was copied completely, or ask for a new one.
      </AppText>
    );
  } else if (!isLoaded) {
    body = <ActivityIndicator color={colors.primaryLight} accessibilityLabel="Loading" />;
  } else if (!isSignedIn) {
    body = (
      <>
        <AppText tone="secondary">Sign in with the email address the invite was sent to. You&apos;ll come back here to accept it.</AppText>
        <Button label="Sign in to accept" variant="primary" onPress={() => router.push('/sign-in')} />
      </>
    );
  } else {
    body = (
      <>
        {error ? (
          <AppText tone="danger" role="alert">
            {error.text}
          </AppText>
        ) : (
          <AppText tone="secondary">Accept to join the household and see its budget.</AppText>
        )}
        {!error?.final ? (
          <Button label="Accept invite" variant="primary" busy={busy} onPress={() => void accept()} />
        ) : null}
      </>
    );
  }

  return (
    <WelcomeHero>
      <View style={styles.box}>
        <AppText variant="title">You&apos;ve been invited to a household</AppText>
        {body}
        {isSignedIn || !valid ? <Button label={error?.final || !valid ? 'Go to the app' : 'Not now'} onPress={() => void dismiss()} /> : null}
      </View>
    </WelcomeHero>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.md, width: '100%' },
});
