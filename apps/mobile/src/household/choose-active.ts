import type { MeResponse } from '@bdgtr/shared';

type Membership = MeResponse['memberships'][number];

/**
 * Which household to show: the one remembered on this device if the user is
 * still an active member of it, otherwise their first (oldest) household, or
 * null if they have none yet.
 */
export function chooseActiveHousehold(memberships: Membership[], storedId: string | null): string | null {
  if (storedId && memberships.some((m) => m.householdId === storedId)) return storedId;
  return memberships[0]?.householdId ?? null;
}

/** Storage key for the remembered household, per signed-in user. */
export function activeHouseholdKey(clerkUserId: string): string {
  return `bdgtr.activeHousehold.${clerkUserId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}
