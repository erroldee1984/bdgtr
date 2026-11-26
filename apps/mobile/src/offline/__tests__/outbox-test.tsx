/** Offline entry: the outbox and its sender (docs/PLAN.md §15). Android app. */
import type { CreateTransactionInput } from '@bdgtr/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';

import { ApiError } from '@/lib/api-error';
import { loadOutbox, outboxName, retryDelayMs } from '@/offline/outbox';
import { bannerText, OfflineBanner } from '@/offline/offline-banner';
import { OutboxProvider, refusalText, useOutbox } from '@/offline/outbox-context';
import { vaultSet } from '@/offline/vault';
import { NeedsAttention, WaitingSpends } from '@/offline/waiting-spends';

const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockSecure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockSecure.set(k, v),
}));
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(jest.requireActual('crypto').randomBytes(n)) }));

let mockUser = 'user_a';
const mockGetToken = async () => 't';
jest.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: true, userId: mockUser, getToken: mockGetToken }) }));
const mockToasts: { title: string }[] = [];
const mockToast = { show: (t: { title: string }) => void mockToasts.push(t) };
jest.mock('@/toast/toast', () => ({ useToast: () => mockToast }));
const mockCreate = jest.fn();
jest.mock('@/lib/api', () => ({ ApiError: jest.requireActual('@/lib/api-error').ApiError, createTransaction: (...a: unknown[]) => mockCreate(...a) }));

const NET = () => new TypeError('Network request failed');
const ok = (alerts: unknown[] = []) => ({ transaction: {}, alerts });
let n = 0;
const input = (amountMinor: number, date = '2026-11-25'): CreateTransactionInput => ({
  clientId: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  date,
  categoryId: 'c'.repeat(24),
  amountMinor,
});

let api: ReturnType<typeof useOutbox>;
const keep = (a: ReturnType<typeof useOutbox>) => {
  api = a;
};
function Probe() {
  const outbox = useOutbox();
  useEffect(() => keep(outbox));
  const now = outbox;
  return <Text>{`items:${now.items.map((i) => `${i.input.amountMinor}/${i.state}`).join(',')} offline:${now.offline}`}</Text>;
}
async function mount(timeoutMs = 15_000) {
  const r = await render(
    <OutboxProvider timeoutMs={timeoutMs}>
      <Probe />
      <OfflineBanner />
      <WaitingSpends householdId="h1" month="2026-11" categories={[{ id: 'c'.repeat(24), name: 'Groceries' } as never]} />
      <NeedsAttention householdId="h1" />
    </OutboxProvider>,
  );
  await act(async () => {});
  return r;
}
const state = () => screen.getByText(/^items:/).props.children as string;

beforeEach(async () => {
  mockUser = 'user_a';
  mockCreate.mockReset();
  mockToasts.length = 0;
  await AsyncStorage.clear();
});

describe('saving a spend', () => {
  it('online: sent straight away, nothing queued', async () => {
    mockCreate.mockResolvedValue(ok([{ level: 'over', title: 'Over budget', body: 'b' }]));
    await mount();
    let r!: Awaited<ReturnType<typeof api.saveSpend>>;
    await act(async () => void (r = await api.saveSpend('h1', input(500))));
    expect(r).toEqual({ queued: false, alerts: [{ level: 'over', title: 'Over budget', body: 'b' }] });
    expect(state()).toBe('items: offline:false');
  });

  it('no connection: queued on this phone (encrypted), shown as Pending, banner says offline', async () => {
    mockCreate.mockRejectedValue(NET());
    await mount();
    await act(async () => void (await api.saveSpend('h1', input(500))));
    expect(state()).toBe('items:500/pending offline:true');
    expect(screen.getByText("You're offline. 1 spend will be sent when you're back online.")).toBeTruthy();
    expect(screen.getByText('Waiting to be sent')).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();
    const raw = await AsyncStorage.getItem(`offline:${outboxName('user_a')}`);
    expect(raw).toMatch(/^[0-9a-f]+$/); // ciphertext only
    expect(await loadOutbox('user_a')).toHaveLength(1);
  });

  it('a save that hangs is queued after the timeout (a late success can’t duplicate: same clientId)', async () => {
    mockCreate.mockReturnValue(new Promise(() => {}));
    await mount(30);
    let r!: Awaited<ReturnType<typeof api.saveSpend>>;
    await act(async () => void (r = await api.saveSpend('h1', input(700))));
    expect(r.queued).toBe(true);
  });

  it('a server refusal (e.g. 400) is shown on the form, not queued', async () => {
    mockCreate.mockRejectedValue(new ApiError(400, 'invalid_input'));
    await mount();
    await expect(act(async () => void (await api.saveSpend('h1', input(1))))).rejects.toBeInstanceOf(ApiError);
    expect(state()).toBe('items: offline:false');
  });
});

describe('sending the queue', () => {
  async function queue(...amounts: number[]) {
    mockCreate.mockRejectedValue(NET());
    await mount();
    for (const a of amounts) await act(async () => void (await api.saveSpend('h1', input(a))));
    mockCreate.mockReset();
  }

  it('back online: sent oldest first, removed, "N spends sent" and their budget alerts', async () => {
    await queue(100, 200, 300);
    const sent: number[] = [];
    mockCreate.mockImplementation(async (_t: unknown, _h: string, i: CreateTransactionInput) => {
      sent.push(i.amountMinor);
      return ok(i.amountMinor === 300 ? [{ level: 'near', title: 'Nearly at budget', body: 'b' }] : []);
    });
    await act(async () => api.syncNow());
    await waitFor(() => expect(state()).toBe('items: offline:false'));
    expect(sent).toEqual([100, 200, 300]);
    expect(mockToasts.map((t) => t.title)).toEqual(['3 spends sent', 'Nearly at budget']);
    expect(screen.queryByTestId('offline-banner')).toBeNull();
    expect(await loadOutbox('user_a')).toEqual([]);
  });

  it('still offline: stays pending, counts the attempt', async () => {
    await queue(100);
    mockCreate.mockRejectedValue(NET());
    await act(async () => api.syncNow());
    expect(state()).toBe('items:100/pending offline:true');
    expect((await loadOutbox('user_a'))[0]!.attempts).toBe(1);
  });

  // Regression (offline dev): a refusal is an answer, so the "You're offline" banner must go.
  it('refused (e.g. removed from the household): "Needs attention" with why; Retry resends, Discard drops', async () => {
    await queue(100, 200);
    mockCreate.mockImplementation(async (_t: unknown, _h: string, i: CreateTransactionInput) => {
      if (i.amountMinor === 100) throw new ApiError(404, 'not_found');
      return ok();
    });
    await act(async () => api.syncNow());
    await waitFor(() => expect(state()).toBe('items:100/needs_attention offline:false')); // 200 still went
    expect(screen.getByText("This household isn't available to you any more.")).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeTruthy();

    mockCreate.mockResolvedValue(ok());
    await act(async () => api.retry(api.items[0]!.clientId));
    await waitFor(() => expect(state()).toBe('items: offline:false'));

    await queue(50);
    mockCreate.mockRejectedValue(new ApiError(403, 'forbidden'));
    await act(async () => api.syncNow());
    await waitFor(() => expect(state()).toContain('needs_attention'));
    await act(async () => api.discard(api.items[0]!.clientId));
    expect(state()).toBe('items: offline:false');
  });

  it('sign-in expired (401): sending pauses, nothing is marked as a problem', async () => {
    await queue(100);
    mockCreate.mockRejectedValue(new ApiError(401, 'not_signed_in'));
    await act(async () => api.syncNow());
    expect(state()).toBe('items:100/pending offline:false'); // online, just needs signing in again
  });

  it('server trouble (5xx): tried again later, not marked as a problem', async () => {
    await queue(100);
    mockCreate.mockRejectedValue(new ApiError(503, 'unavailable'));
    await act(async () => api.syncNow());
    expect(state()).toContain('100/pending');
  });

  it('app closed with a queue: the next launch sends it', async () => {
    await queue(100);
    await act(async () => screen.unmount());
    mockCreate.mockResolvedValue(ok());
    await mount();
    await waitFor(() => expect(state()).toBe('items: offline:false'));
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('a corrupt stored entry is set aside; the rest still send', async () => {
    const good = { clientId: 'g', householdId: 'h1', input: input(100), savedAt: '2026-11-25T00:00:00.000Z', attempts: 0, state: 'pending', problem: null };
    await vaultSet(outboxName('user_a'), [{ junk: true }, good]);
    mockCreate.mockResolvedValue(ok());
    await mount();
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  });

  it('each person has their own outbox', async () => {
    await queue(100);
    await act(async () => screen.unmount());
    mockUser = 'user_b';
    mockCreate.mockRejectedValue(NET());
    await mount();
    expect(state()).toBe('items: offline:false');
  });
});

describe('wording', () => {
  it('banner', () => {
    expect(bannerText(false, 0)).toBeNull();
    expect(bannerText(true, 0)).toBe("You're offline. Spends you add are saved on this phone and sent later.");
    expect(bannerText(true, 2)).toBe("You're offline. 2 spends will be sent when you're back online.");
    expect(bannerText(false, 1)).toBe('1 spend waiting to be sent.');
  });
  it('refusals', () => {
    expect(refusalText(new ApiError(409, 'category_removed'))).toMatch(/category was removed/);
    expect(refusalText(new ApiError(403, 'forbidden'))).toMatch(/no longer allowed/);
    expect(refusalText(new ApiError(400, 'invalid_input'))).toMatch(/didn't accept/);
    expect(refusalText(new ApiError(418, 'x'))).toBe("The server didn't accept it.");
  });
  it('retry waits grow, then settle at 5 minutes', () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([5000, 15000, 30000, 60000, 300000, 300000]);
  });
});
