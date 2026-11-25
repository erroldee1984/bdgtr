/** /invite/<token>: opening a shared invite link, signed out and signed in. */
import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import InviteScreen from '@/app/invite/[token]';
import { readPendingInvite, rememberPendingInvite } from '@/household/pending-invite';
import { RequireHousehold } from '@/household/require-household';
import { ApiError } from '@/lib/api-error';

let mockAuth = { isLoaded: true, isSignedIn: true, getToken: async () => 'tok' };
jest.mock('@clerk/expo', () => ({ useAuth: () => mockAuth }));
const mockStore = new Map<string, string>();
jest.mock('@/lib/storage', () => ({
  getItem: async (k: string) => mockStore.get(k) ?? null,
  setItem: async (k: string, v: string) => void mockStore.set(k, v),
  removeItem: async (k: string) => void mockStore.delete(k),
}));
const mockRefresh = jest.fn(async () => {});
let mockHousehold: Record<string, unknown>;
jest.mock('@/household/household-context', () => ({ useHousehold: () => mockHousehold }));
const mockAccept = jest.fn();
jest.mock('@/lib/api', () => ({
  ApiError: jest.requireActual('@/lib/api-error').ApiError,
  acceptInvite: (...a: unknown[]) => mockAccept(...a),
}));

const TOKEN = 'Ab-_'.padEnd(43, 'x');

beforeEach(() => {
  mockStore.clear();
  mockRefresh.mockClear();
  mockAccept.mockReset().mockResolvedValue({ householdId: 'h'.repeat(24), householdName: 'Dela Cruz', role: 'member' });
  mockAuth = { isLoaded: true, isSignedIn: true, getToken: async () => 'tok' };
  mockHousehold = { refresh: mockRefresh, state: { status: 'ready' }, active: { householdId: 'h1', householdName: 'Home', role: 'owner' } };
});

const open = (token = TOKEN) =>
  renderRouter(
    {
      index: () => <Text>Home screen</Text>,
      'sign-in': () => <Text>Sign-in screen</Text>,
      'invite/[token]': InviteScreen,
    },
    { initialUrl: `/invite/${token}` },
  );

describe('invite link, signed in', () => {
  it('accepting joins, makes that household active and opens the app', async () => {
    await open();
    await fireEvent.press(screen.getByText('Accept invite'));
    await screen.findByText('Home screen');
    expect(mockAccept).toHaveBeenCalledWith(expect.any(Function), TOKEN);
    expect(mockRefresh).toHaveBeenCalledWith('h'.repeat(24));
  });

  it('never accepts just by opening the link', async () => {
    await open();
    expect(mockAccept).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError(403, 'email_mismatch'), /sent to a different email address/, true],
    [new ApiError(410, 'invite_expired'), /expired or was already used/, true],
    [new ApiError(410, 'invite_used'), /expired or was already used/, true],
    [new ApiError(404, 'not_found'), /isn't valid/, true],
    [new ApiError(409, 'already_member'), /already a member/, true],
    [new ApiError(409, 'household_limit'), /maximum number of households/, true],
    [new ApiError(429, 'too_many_attempts'), /Try again in 15 minutes/, true],
    [new TypeError('Network request failed'), /Check your connection/, false],
  ])('%s → explains it (Accept hidden when retrying cannot help: %s)', async (err, message, final) => {
    mockAccept.mockRejectedValue(err);
    await rememberPendingInvite(TOKEN);
    await open();
    await fireEvent.press(screen.getByText('Accept invite'));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(!!screen.queryByText('Accept invite')).toBe(!final);
    // A dead invite is forgotten (no endless redirect back to it); a network blip is kept.
    expect(await readPendingInvite()).toBe(final ? null : TOKEN);
  });

  it('"Not now" forgets the invite and opens the app', async () => {
    await rememberPendingInvite(TOKEN);
    await open();
    await fireEvent.press(screen.getByText('Not now'));
    await screen.findByText('Home screen');
    expect(await readPendingInvite()).toBeNull();
  });
});

describe('invite link, signed out', () => {
  it('remembers the invite and sends you to sign in first', async () => {
    mockAuth = { ...mockAuth, isSignedIn: false };
    await open();
    expect(screen.queryByText('Accept invite')).toBeNull();
    await fireEvent.press(screen.getByText('Sign in to accept'));
    await screen.findByText('Sign-in screen');
    expect(await readPendingInvite()).toBe(TOKEN);
  });

  it('a malformed link is rejected and nothing is remembered', async () => {
    mockAuth = { ...mockAuth, isSignedIn: false };
    await open('short');
    expect(screen.getByText(/isn't valid/)).toBeTruthy();
    expect(screen.queryByText('Sign in to accept')).toBeNull();
    expect(await readPendingInvite()).toBeNull();
  });
});

describe('after signing in, the app returns to a remembered invite', () => {
  const app = () =>
    renderRouter(
      {
        index: () => (
          <RequireHousehold>
            <Text>Dashboard</Text>
          </RequireHousehold>
        ),
        onboarding: () => <Text>Create your household</Text>,
        'invite/[token]': () => <Text>Invite screen</Text>,
      },
      { initialUrl: '/' },
    );

  it('goes to the invite instead of the dashboard', async () => {
    await rememberPendingInvite(TOKEN);
    await app();
    await screen.findByText('Invite screen');
  });

  it('goes to the invite instead of "Create your household" for a brand-new user', async () => {
    mockHousehold = { ...mockHousehold, active: null };
    await rememberPendingInvite(TOKEN);
    await app();
    await screen.findByText('Invite screen');
  });

  it('without a remembered invite: dashboard as usual', async () => {
    await app();
    await screen.findByText('Dashboard');
  });

  it('ignores a corrupted remembered value', async () => {
    mockStore.set('bdgtr.pendingInvite', '../../evil');
    await app();
    await act(async () => {});
    await screen.findByText('Dashboard');
  });
});
