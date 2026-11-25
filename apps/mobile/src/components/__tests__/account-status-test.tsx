/** Dashboard "Setup check": account status card and the server connection check with retries. */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { AccountStatus } from '@/components/account-status';
import { checkApiHealthWithRetry } from '@/lib/api-health';
import { ApiError } from '@/lib/api-error';

const mockLoadMe = jest.fn();
jest.mock('@/lib/api', () => ({
  ApiError: jest.requireActual('@/lib/api-error').ApiError,
  useFetchMe: () => mockLoadMe,
}));
// One quick retry instead of real delays.
jest.mock('@/lib/retry', () => ({
  withNetworkRetry: (fn: () => Promise<unknown>) => fn().catch(() => fn()),
}));

beforeEach(() => mockLoadMe.mockReset());

describe('AccountStatus', () => {
  it('shows who is signed in', async () => {
    mockLoadMe.mockResolvedValue({ user: { id: 'u', email: 'ana@example.com' }, memberships: [] });
    await render(<AccountStatus />);
    expect(await screen.findByText('Signed in as ana@example.com')).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('copes with an account that has no email', async () => {
    mockLoadMe.mockResolvedValue({ user: { id: 'u', email: null }, memberships: [] });
    await render(<AccountStatus />);
    expect(await screen.findByText('Signed in as your account')).toBeTruthy();
  });

  it.each([
    [new ApiError(401, 'unauthorized'), 'The server did not accept your sign-in.'],
    [new ApiError(503, 'auth_not_configured'), 'The server is not set up for sign-in yet.'],
    [new TypeError('Network request failed'), "Couldn't reach the server to load your account."],
  ])('on %s shows a plain message and Try again, which recovers', async (err, message) => {
    mockLoadMe.mockRejectedValueOnce(err).mockResolvedValue({ user: { id: 'u', email: 'ana@example.com' }, memberships: [] });
    await render(<AccountStatus />);
    expect(await screen.findByText(message)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Try loading your account again'));
    expect(await screen.findByText('Signed in as ana@example.com')).toBeTruthy();
  });
});

describe('checkApiHealthWithRetry', () => {
  const good = { status: 'ok', service: 'bdgtr-api', time: '2026-11-25T00:00:00.000Z' };
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  it('connects after a network blip (retried)', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Network request failed')).mockResolvedValue(new Response(JSON.stringify(good)));
    await expect(checkApiHealthWithRetry('https://api.example')).resolves.toBe('connected');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('reports unreachable (never throws) when every attempt fails', async () => {
    fetchSpy.mockRejectedValue(new TypeError('Network request failed'));
    await expect(checkApiHealthWithRetry('https://api.example')).resolves.toBe('unreachable');
  });

  it('does not retry a server that answered wrongly', async () => {
    fetchSpy.mockResolvedValue(new Response('{"error":"x"}', { status: 500 }));
    await expect(checkApiHealthWithRetry('https://api.example')).resolves.toBe('unexpected_response');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
