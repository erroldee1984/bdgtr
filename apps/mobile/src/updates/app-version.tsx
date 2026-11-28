import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { spacing } from '@/theme/tokens';

import { useUpdateReady } from './update-ready';

const DAY = new Intl.DateTimeFormat('en-PH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Manila' });

/** "bdgtr 1.0.2" plus, when running an over-the-air update, when it was published. */
export function versionText(version: string | undefined, embedded: boolean, createdAt: Date | undefined): string {
  const base = `bdgtr ${version ?? ''}`.trim();
  return !embedded && createdAt ? `${base}, updated ${DAY.format(createdAt)}` : base;
}

/**
 * Android app (docs/PLAN.md §2c): which version is running, and a Restart
 * button once an over-the-air update has downloaded. Updates also apply on
 * their own the next time the app is opened. Nothing on the website, which
 * updates on every deploy.
 */
export function AppVersion() {
  if (Platform.OS === 'web') return null;
  return <NativeAppVersion />;
}

function NativeAppVersion() {
  const { currentlyRunning } = Updates.useUpdates();
  const { ready, restarting, restart } = useUpdateReady();
  return (
    <View style={styles.wrap}>
      <AppText variant="caption" tone="secondary">
        {versionText(
          // The installed APK's own version: an update carries the newest app.json, which may name a newer APK.
          Application.nativeApplicationVersion ?? Constants.expoConfig?.version,
          currentlyRunning.isEmbeddedLaunch,
          currentlyRunning.createdAt,
        )}
      </AppText>
      {ready ? (
        <View style={styles.pending} role="status">
          <AppText>An update is ready. It applies the next time you open bdgtr, or restart now.</AppText>
          <Button label="Restart now" compact busy={restarting} onPress={restart} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  pending: { gap: spacing.sm, alignItems: 'flex-start' },
});
