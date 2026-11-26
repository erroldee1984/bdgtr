import { useAuth } from '@clerk/expo';
import { type Href, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { useToast } from '@/toast/toast';

import { onForegroundAlert, onNotificationTap, syncPush } from './device-push';

/**
 * Keeps this device's notifications pointed at whoever is signed in, shows
 * alerts that arrive while the app is open and in front as toasts (instead of
 * a duplicate system notification), and opens the Alerts tab when a phone
 * notification is tapped.
 */
export function PushBridge() {
  const { isSignedIn, userId, getToken } = useAuth();
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    if (isSignedIn && userId) void syncPush(() => getToken());
  }, [isSignedIn, userId, getToken]);

  useEffect(() => onForegroundAlert((a) => toast.show(a)), [toast]);
  useEffect(() => onNotificationTap((path) => router.push(path as Href)), [router]);
  return null;
}
