import { CreateTransactionInputSchema } from '@bdgtr/shared';
import { z } from 'zod';

import { vaultGet, vaultSet } from './vault';

/**
 * Spends saved while offline (docs/PLAN.md §15), per signed-in person, in
 * the encrypted vault. Sent oldest first. Each keeps its clientId, so sending
 * one twice is harmless: the server returns the original.
 */
export const OutboxItemSchema = z.object({
  clientId: z.string(),
  householdId: z.string(),
  input: CreateTransactionInputSchema,
  /** When it was saved on this device. */
  savedAt: z.string(),
  attempts: z.number().int().min(0),
  /** 'pending' sends automatically; 'needs_attention' waits for Retry or Discard. */
  state: z.enum(['pending', 'needs_attention']),
  /** Why the server refused it (needs_attention). */
  problem: z.string().nullable(),
  /**
   * Queued because the server didn't answer in time, so it may already have
   * arrived. Such a spend can't be edited here: the server would keep the
   * original under the same clientId. Missing on older entries = false.
   */
  uncertain: z.boolean().optional(),
});
export type OutboxItem = z.infer<typeof OutboxItemSchema>;

export const outboxName = (userId: string) => `outbox:${userId}`;

/**
 * The stored outbox. Entries that don't read back correctly are left out
 * (quarantined) so one bad entry never stops the rest from sending.
 */
export async function loadOutbox(userId: string): Promise<OutboxItem[]> {
  const raw = await vaultGet(outboxName(userId));
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    const r = OutboxItemSchema.safeParse(x);
    return r.success ? [r.data] : [];
  });
}

export async function saveOutbox(userId: string, items: OutboxItem[]): Promise<boolean> {
  return vaultSet(outboxName(userId), items);
}

/** Retry waits after network failures: 5 s, 15 s, 30 s, 1 min, then every 5 min. */
export function retryDelayMs(failures: number): number {
  const steps = [5_000, 15_000, 30_000, 60_000];
  return steps[Math.max(0, failures - 1)] ?? 300_000;
}
