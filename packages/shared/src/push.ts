import { z } from 'zod';

/**
 * Notifications on devices (docs/PLAN.md §2b). Web Push in browsers now;
 * Android (Expo push) joins in M2b-3.
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

export const RegisterDeviceInputSchema = z
  .object({
    kind: z.literal('webpush'),
    subscription: WebPushSubscriptionSchema,
    /** e.g. "Chrome on Windows": shown in Settings so people can tell devices apart. */
    deviceLabel: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), 'Invalid characters'),
  })
  .strict();
export type RegisterDeviceInput = z.infer<typeof RegisterDeviceInputSchema>;

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
