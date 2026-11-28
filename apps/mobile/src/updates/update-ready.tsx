import * as Updates from 'expo-updates';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { useToast } from '@/toast/toast';
import { colors, spacing } from '@/theme/tokens';

export const UPDATE_TITLE = 'Update ready';
export const UPDATE_BODY = 'A new version of bdgtr has downloaded. Restart to use it, or it applies the next time you open the app.';

interface UpdateReady {
  /** An over-the-air update has downloaded and runs after a restart. */
  ready: boolean;
  restarting: boolean;
  restart: () => void;
}

const NONE: UpdateReady = { ready: false, restarting: false, restart: () => {} };
const Ctx = createContext<UpdateReady>(NONE);

/**
 * Android app (docs/PLAN.md §2c): when an update finishes downloading, a
 * growl with Restart appears once, and the Alerts screen shows an "Update
 * ready" card (also counted on the Alerts tab badge) until the app restarts.
 * The website updates on every deploy, so it never shows any of this.
 */
export function UpdateReadyProvider({ children }: { children: ReactNode }) {
  if (Platform.OS === 'web') return <>{children}</>;
  return <NativeUpdateReady>{children}</NativeUpdateReady>;
}

function NativeUpdateReady({ children }: { children: ReactNode }) {
  const { isUpdatePending, downloadedUpdate } = Updates.useUpdates();
  const toast = useToast();
  const [restarting, setRestarting] = useState(false);
  const announced = useRef<string | null>(null);

  const restart = useCallback(() => {
    setRestarting(true);
    Updates.reloadAsync().catch(() => setRestarting(false));
  }, []);

  useEffect(() => {
    if (!isUpdatePending) return;
    const id = downloadedUpdate?.updateId ?? 'pending';
    if (announced.current === id) return; // one growl per update
    announced.current = id;
    toast.show({ level: 'near', icon: 'update', title: UPDATE_TITLE, body: UPDATE_BODY, action: { label: 'Restart', onPress: restart } });
  }, [isUpdatePending, downloadedUpdate, toast, restart]);

  const value = useMemo(() => ({ ready: isUpdatePending, restarting, restart }), [isUpdatePending, restarting, restart]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUpdateReady(): UpdateReady {
  return useContext(Ctx);
}

/** The "Update ready" card at the top of the Alerts screen. */
export function UpdateReadyCard() {
  const { ready, restarting, restart } = useUpdateReady();
  if (!ready) return null;
  return (
    <Card testID="update-ready">
      <View style={styles.titleRow}>
        <MaterialCommunityIcons name="update" size={22} color={colors.primaryLight} aria-hidden />
        <AppText variant="bodyStrong" tone="primary" style={styles.flex}>
          {UPDATE_TITLE}
        </AppText>
      </View>
      <AppText>{UPDATE_BODY}</AppText>
      <Button label="Restart now" icon="restart" variant="primary" compact busy={restarting} onPress={restart} />
    </Card>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
});
