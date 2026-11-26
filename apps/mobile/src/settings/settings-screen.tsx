import type { Device } from '@bdgtr/shared';
import { useAuth } from '@clerk/expo';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { useHousehold } from '@/household/household-context';
import { fetchDevices, fetchMembershipSettings, removeDevice, updateMembershipSettings } from '@/lib/api';
import { disablePush, enablePush, type PushStatus, pushStatus } from '@/notifications/device-push';
import { colors, spacing } from '@/theme/tokens';

const STATUS_TEXT: Record<PushStatus, string> = {
  on: 'Notifications are on for this browser. Budget alerts arrive even when bdgtr isn’t open.',
  off: 'Get budget alerts on this browser, even when bdgtr isn’t open.',
  blocked:
    'This browser is blocking notifications from bdgtr. Allow them in the browser’s site settings (the icon next to the address), then come back.',
  unsupported:
    Platform.OS === 'web'
      ? 'This browser can’t show notifications. Try Chrome, Edge, Firefox or Safari.'
      : 'Phone notifications arrive in the next update. Until then, alerts show in the Alerts tab.',
  'needs-install': 'On iPhone and iPad, add bdgtr to your Home Screen first (Share → Add to Home Screen), then open it from there.',
  'server-off': 'Notifications aren’t set up on the server yet.',
};

const DATE = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });

/** More → Settings: notifications on this device, per-household alert mute, your devices. */
export function SettingsScreen() {
  const { getToken } = useAuth();
  const { active } = useHousehold();
  const householdId = active?.householdId ?? null;
  const token = useCallback(() => getToken(), [getToken]);

  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const [muted, setMuted] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [version, setVersion] = useState(0);
  const reloadDevices = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    void pushStatus().then(setStatus);
  }, []);

  useEffect(() => {
    if (!householdId) return;
    let alive = true;
    fetchMembershipSettings(token, householdId)
      .then((s) => alive && setMuted(s.alertsMuted))
      .catch(() => alive && setMuted(null));
    return () => {
      alive = false;
    };
  }, [token, householdId]);

  useEffect(() => {
    let alive = true;
    fetchDevices(token)
      .then((d) => alive && setDevices(d))
      .catch(() => alive && setDevices([]));
    return () => {
      alive = false;
    };
  }, [token, version]);

  async function turnOn() {
    setBusy(true);
    setNote(null);
    try {
      const next = await enablePush(token);
      setStatus(next);
      if (next === 'on') setNote({ tone: 'success', text: 'Notifications turned on for this browser.' });
      reloadDevices();
    } catch {
      setNote({ tone: 'danger', text: "Couldn't turn on notifications. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setNote(null);
    await disablePush(token);
    setStatus(await pushStatus());
    setNote({ tone: 'success', text: 'Notifications turned off for this browser.' });
    reloadDevices();
    setBusy(false);
  }

  async function toggleMute(next: boolean) {
    if (!householdId) return;
    const previous = muted;
    setMuted(next);
    try {
      const saved = await updateMembershipSettings(token, householdId, { alertsMuted: next });
      setMuted(saved.alertsMuted);
    } catch {
      setMuted(previous);
      setNote({ tone: 'danger', text: "Couldn't change that setting. Try again." });
    }
  }

  return (
    <Screen title="Settings">
      <Card>
        <AppText variant="title">Notifications on this device</AppText>
        {status === null ? (
          <ActivityIndicator color={colors.primaryLight} accessibilityLabel="Checking notifications" />
        ) : (
          <>
            <AppText tone="secondary">{STATUS_TEXT[status]}</AppText>
            {status === 'off' ? (
              <Button label="Turn on notifications" variant="primary" icon="bell-ring-outline" busy={busy} onPress={() => void turnOn()} />
            ) : status === 'on' ? (
              <Button label="Turn off on this browser" icon="bell-off-outline" busy={busy} onPress={() => void turnOff()} />
            ) : null}
          </>
        )}
        {note ? (
          <AppText tone={note.tone} role={note.tone === 'danger' ? 'alert' : undefined} aria-live="polite">
            {note.text}
          </AppText>
        ) : null}
      </Card>

      <Card>
        <AppText variant="title">{`Budget alerts for ${active?.householdName ?? 'this household'}`}</AppText>
        <View style={styles.row}>
          <AppText style={styles.flex}>Mute notifications from this household</AppText>
          <Switch
            accessibilityLabel={`Mute notifications from ${active?.householdName ?? 'this household'}`}
            value={muted === true}
            disabled={muted === null}
            onValueChange={(v) => void toggleMute(v)}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>
        <AppText variant="caption" tone="secondary">
          Muting stops notifications on all your devices for this household only. Alerts still appear in the Alerts tab.
        </AppText>
      </Card>

      <Card>
        <AppText variant="title">Your devices</AppText>
        {!devices ? (
          <ActivityIndicator color={colors.primaryLight} accessibilityLabel="Loading devices" />
        ) : devices.length === 0 ? (
          <AppText tone="secondary">No devices get notifications yet.</AppText>
        ) : (
          devices.map((d) => (
            <View key={d.id} style={styles.device} testID="device-row">
              <View style={styles.flex}>
                <AppText variant="bodyStrong">{d.deviceLabel}</AppText>
                <AppText variant="caption" tone="secondary">{`Added ${DATE.format(new Date(d.createdAt))}`}</AppText>
              </View>
              <Button
                label="Remove"
                variant="danger"
                compact
                accessibilityLabel={`Remove ${d.deviceLabel}`}
                onPress={() =>
                  void removeDevice(token, d.id)
                    .then(reloadDevices)
                    .catch(() => setNote({ tone: 'danger', text: "Couldn't remove that device. Try again." }))
                }
              />
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1 },
  device: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});
