import { useAuth } from '@clerk/expo';
import { useEffect } from 'react';

import { useToast } from '@/toast/toast';

import { onForegroundAlert, syncPush } from './device-push';

/**
 * Keeps this device's notifications pointed at whoever is signed in, and
 * shows alerts that arrive while the app is open and in front as toasts
 * (instead of a duplicate system notification).
 */
export function PushBridge() {
  const { isSignedIn, userId, getToken } = useAuth();
  const toast = useToast();

  useEffect(() => {
    if (isSignedIn && userId) void syncPush(() => getToken());
  }, [isSignedIn, userId, getToken]);

  useEffect(() => onForegroundAlert((a) => toast.show(a)), [toast]);
  return null;
}
