import {
  deviceAddress,
  type DeviceResponse,
  type DevicesResponse,
  type MembershipSettings,
  RegisterDeviceInputSchema,
  UnregisterDeviceInputSchema,
  UpdateMembershipSettingsSchema,
  type VapidKeyResponse,
} from '@bdgtr/shared';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { type Db, ObjectId } from 'mongodb';

import { type AppVariables, requireHousehold } from './household-routes.js';
import { MEMBERSHIPS, type MembershipDoc } from './households.js';
import {
  countDevices,
  listDevices,
  MAX_DEVICES_PER_USER,
  PUSH_SUBSCRIPTIONS,
  type PushSubscriptionDoc,
  registerDevice,
  removeDevice,
  toDevice,
} from './push.js';
import { parseJsonBody } from './validation.js';

type AppEnv = { Variables: AppVariables };

interface Deps {
  getDb: () => Promise<Db>;
  now: () => Date;
  /** Web Push public key, or null when push isn't configured. */
  vapidPublicKey: string | null;
}

function idParam(c: Context<AppEnv>, name: string): ObjectId | null {
  const raw = c.req.param(name) ?? '';
  return /^[0-9a-f]{24}$/.test(raw) ? new ObjectId(raw) : null;
}

const settingsOf = (m: MembershipDoc): MembershipSettings => ({
  alertsMuted: m.alertsMuted === true,
  dailyDigestEnabled: m.dailyDigestEnabled !== false,
});

/**
 * Devices for notifications and per-household notification settings
 * (docs/PLAN.md §2b, §5). Devices belong to a person, not a household; each
 * person can only see or remove their own.
 */
export function registerPushRoutes(
  app: Hono<AppEnv>,
  auth: MiddlewareHandler<AppEnv>,
  loadUser: MiddlewareHandler<AppEnv>,
  deps: Deps,
) {
  // Public by design: the browser needs it to subscribe.
  app.get('/push/vapid-public-key', (c) => {
    if (!deps.vapidPublicKey) return c.json({ error: 'push_not_configured' }, 503);
    return c.json<VapidKeyResponse>({ publicKey: deps.vapidPublicKey });
  });

  app.get('/push-subscriptions', auth, loadUser, async (c) => {
    const db = await deps.getDb();
    return c.json<DevicesResponse>({ devices: (await listDevices(db, c.get('user')._id)).map(toDevice) });
  });

  app.post('/push-subscriptions', auth, loadUser, async (c) => {
    const input = await parseJsonBody(c, RegisterDeviceInputSchema);
    const db = await deps.getDb();
    const me = c.get('user')._id;
    const known = await db.collection<PushSubscriptionDoc>(PUSH_SUBSCRIPTIONS).findOne({ endpoint: deviceAddress(input), userId: me });
    if (!known && (await countDevices(db, me)) >= MAX_DEVICES_PER_USER) return c.json({ error: 'device_limit' }, 409);
    const doc = await registerDevice(db, me, input, deps.now());
    return c.json<DeviceResponse>({ device: toDevice(doc) }, known ? 200 : 201);
  });

  // Forget this browser or phone (sign-out, "turn off here"). Only your own; always 204.
  app.post('/push-subscriptions/unregister', auth, loadUser, async (c) => {
    const { endpoint } = await parseJsonBody(c, UnregisterDeviceInputSchema);
    const db = await deps.getDb();
    await db.collection<PushSubscriptionDoc>(PUSH_SUBSCRIPTIONS).deleteOne({ endpoint, userId: c.get('user')._id });
    return c.body(null, 204);
  });

  app.delete('/push-subscriptions/:id', auth, loadUser, async (c) => {
    const id = idParam(c, 'id');
    if (!id) return c.json({ error: 'not_found' }, 404);
    const db = await deps.getDb();
    if (!(await removeDevice(db, c.get('user')._id, id))) return c.json({ error: 'not_found' }, 404);
    return c.body(null, 204);
  });

  // Your own settings for the household in X-Household-Id.
  app.get('/membership/me', auth, loadUser, requireHousehold(deps, 'view'), (c) =>
    c.json<MembershipSettings>(settingsOf(c.get('membership'))),
  );

  app.patch('/membership/me', auth, loadUser, requireHousehold(deps, 'view'), async (c) => {
    const input = await parseJsonBody(c, UpdateMembershipSettingsSchema);
    const db = await deps.getDb();
    const set: Partial<MembershipDoc> = { updatedAt: deps.now() };
    if (input.alertsMuted !== undefined) set.alertsMuted = input.alertsMuted;
    if (input.dailyDigestEnabled !== undefined) set.dailyDigestEnabled = input.dailyDigestEnabled;
    const updated = await db
      .collection<MembershipDoc>(MEMBERSHIPS)
      .findOneAndUpdate({ _id: c.get('membership')._id }, { $set: set }, { returnDocument: 'after' });
    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json<MembershipSettings>(settingsOf(updated));
  });
}
