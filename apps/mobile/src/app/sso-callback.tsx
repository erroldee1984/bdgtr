import { useAuth } from '@clerk/expo';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

/** If the sign-in never finishes (closed browser, error), go back to it. */
const GIVE_UP_MS = 15_000;

/**
 * Google sign-in returns to bdgtr://sso-callback. Without a screen here,
 * "page not found" flashed until the sign-in screen moved on (regression,
 * PLAN §11). Shows a quiet spinner and goes home once the session is ready.
 */
export default function SsoCallback() {
  const { isLoaded, isSignedIn } = useAuth();
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGaveUp(true), GIVE_UP_MS);
    return () => clearTimeout(t);
  }, []);
  if (isLoaded && isSignedIn) return <Redirect href="/" />;
  if (gaveUp) return <Redirect href="/sign-in" />;
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.primaryLight} accessibilityLabel="Signing in" />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
});
