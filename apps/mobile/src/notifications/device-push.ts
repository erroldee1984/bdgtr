/**
 * Native (Android) stand-in: phone notifications arrive with M2b-3 (Expo push).
 * Same interface as device-push.web.ts.
 */
type GetToken = () => Promise<string | null>;
export type PushStatus = 'on' | 'off' | 'blocked' | 'unsupported' | 'needs-install' | 'server-off';

export async function pushStatus(): Promise<PushStatus> {
  return 'unsupported';
}
export async function enablePush(_getToken: GetToken): Promise<PushStatus> {
  return 'unsupported';
}
export async function disablePush(_getToken: GetToken): Promise<void> {}
export async function syncPush(_getToken: GetToken): Promise<void> {}
export async function forgetPushOnSignOut(_getToken: GetToken): Promise<void> {}
export function onForegroundAlert(_handler: (alert: { level: 'near' | 'over'; title: string; body: string }) => void): () => void {
  return () => {};
}
