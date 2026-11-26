import { z } from 'zod';

/**
 * Notifications on devices (docs/PLAN.md §2b): Web Push in browsers, Expo push
 * (→ Firebase Cloud Messaging) in the Android app.
 */

/**
 * The server only ever delivers to the real browser push services, so a
 * crafted "subscription" can't make it send requests to arbitrary addresses.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge (Chromium), Android browsers
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/, // legacy Edge / Windows
  /^web\.push\.apple\.com$/, // Safari (macOS, iOS home-screen apps)
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  // https://<host>/... with no credentials or port (a strict pattern; no URL parser in shared code).
  const m = /^https:\/\/([^/?#]+)(?:[/?#]|$)/.exec(endpoint);
  if (!m) return false;
  const host = m[1]!;
  if (host.includes('@') || host.includes(':')) return false;
  return PUSH_HOSTS.some((re) => re.test(host.toLowerCase()));
}

const base64url = (min: number, max: number) => z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${min},${max}}={0,2}$`));

export const WebPushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .max(1000)
    .refine(isAllowedPushEndpoint, 'Not a supported push service'),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: base64url(80, 100),
    auth: base64url(16, 30),
  }),
});
export type WebPushSubscriptionJSON = z.infer<typeof WebPushSubscriptionSchema>;

/**
 * The Android app's address for notifications. The server only ever sends it
 * to Expo's push service, never anywhere the client chooses.
 */
export const EXPO_PUSH_TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{1,200}\]$/;

/**
 * A browser sends its Web Push subscription; the Android app sends its Expo
 * push token. (One flat object rather than a union: the API's Vercel build
 * type-checks without strictNullChecks.)
 */
export const RegisterDeviceInputSchema = z
  .object({
    kind: z.enum(['webpush', 'expo']),
    subscription: WebPushSubscriptionSchema.optional(),
    expoPushToken: z.string().regex(EXPO_PUSH_TOKEN).optional(),
    /** e.g. "Chrome on Windows" or "Samsung Galaxy A54": shown in Settings so people can tell devices apart. */
    deviceLabel: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), 'Invalid characters'),
  })
  .strict()
  .refine(
    (v) =>
      v.kind === 'webpush'
        ? v.subscription !== undefined && v.expoPushToken === undefined
        : v.expoPushToken !== undefined && v.subscription === undefined,
    { message: 'Send a subscription for a browser, or an Expo push token for the app' },
  );
export type RegisterDeviceInput = z.infer<typeof RegisterDeviceInputSchema>;

/** The one address a device is known by: the browser's endpoint or the app's Expo token. */
export function deviceAddress(input: RegisterDeviceInput): string {
  return input.kind === 'expo' ? input.expoPushToken! : input.subscription!.endpoint;
}

/** Sign-out / "turn off here": forget the device by its address (endpoint or Expo token). */
export const UnregisterDeviceInputSchema = z.object({ endpoint: z.string().max(1000) }).strict();
export type UnregisterDeviceInput = z.infer<typeof UnregisterDeviceInputSchema>;

export const DeviceSchema = z.object({
  id: z.string(),
  kind: z.enum(['webpush', 'expo']),
  deviceLabel: z.string(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
});
export type Device = z.infer<typeof DeviceSchema>;

export const DevicesResponseSchema = z.object({ devices: z.array(DeviceSchema) });
export type DevicesResponse = z.infer<typeof DevicesResponseSchema>;
export const DeviceResponseSchema = z.object({ device: DeviceSchema });
export type DeviceResponse = z.infer<typeof DeviceResponseSchema>;

export const VapidKeyResponseSchema = z.object({ publicKey: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/) });
export type VapidKeyResponse = z.infer<typeof VapidKeyResponseSchema>;

/** Android notification channel for budget alerts (people can tune it in Android settings). */
export const ANDROID_ALERT_CHANNEL = 'budget-alerts';

/** What a notification carries. Never a spend's description (lock screens). */
export const PushPayloadSchema = z.object({
  type: z.literal('alert'),
  title: z.string(),
  body: z.string(),
  level: z.enum(['near', 'over']),
  householdId: z.string(),
  /** Where tapping it goes. */
  url: z.string().startsWith('/'),
  /** Same tag replaces the previous notification for that category/total instead of stacking. */
  tag: z.string(),
});
export type PushPayload = z.infer<typeof PushPayloadSchema>;

/** Per household, per member (docs/PLAN.md §2b, §6.11). */
export const MembershipSettingsSchema = z.object({
  alertsMuted: z.boolean(),
  dailyDigestEnabled: z.boolean(),
});
export type MembershipSettings = z.infer<typeof MembershipSettingsSchema>;

export const UpdateMembershipSettingsSchema = z
  .object({ alertsMuted: z.boolean().optional(), dailyDigestEnabled: z.boolean().optional() })
  .strict()
  .refine((v) => v.alertsMuted !== undefined || v.dailyDigestEnabled !== undefined, { message: 'Nothing to update' });
export type UpdateMembershipSettings = z.infer<typeof UpdateMembershipSettingsSchema>;

/** A friendly name for this browser, e.g. "Chrome on Windows". */
export function deviceLabelFromUserAgent(ua: string): string {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'this device';
  return `${browser} on ${os}`;
}
