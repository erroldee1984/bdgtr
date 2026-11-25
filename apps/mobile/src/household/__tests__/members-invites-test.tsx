/**
 * Household screen → Members and Invite sections, per role, against a small
 * in-memory fake server. Real screen, real HouseholdProvider.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import HouseholdScreen from '@/app/household';
import { HouseholdProvider } from '@/household/household-context';
import { ApiError } from '@/lib/api-error';

const mockAuth = { isLoaded: true, isSignedIn: true, userId: 'user_me', getToken: async () => 'tok' };
jest.mock('@clerk/expo', () => ({ useAuth: () => mockAuth }));
jest.mock('@/lib/retry', () => ({ withNetworkRetry: (fn: () => Promise<unknown>) => fn() }));
jest.mock('@/lib/storage', () => ({ getItem: async () => null, setItem: async () => {}, removeItem: async () => {} }));
const mockShare = jest.fn(async () => 'shared');
jest.mock('@/lib/share', () => ({ shareLink: (...a: unknown[]) => mockShare(...(a as [])) }));
jest.mock('@/lib/config', () => ({ ...jest.requireActual('@/lib/config'), webUrl: () => 'https://bdgtr.erroldee.com' }));

type Role = 'owner' | 'co_owner' | 'member';
type M = { userId: string; name: string | null; email: string; role: Role; joinedAt: string; isYou: boolean };
const mockH = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const mockMeId = '111111111111111111111111';
const BEN = '222222222222222222222222';
const CARA = '333333333333333333333333';
const mockToken = 'T'.repeat(43);

// The fake server's state.
let mockMembers: M[];
let mockInvites: { id: string; email: string; role: 'co_owner' | 'member'; expiresAt: string }[];
let mockFail: Partial<Record<string, unknown>>;
const mockCalls: string[] = [];
const mockMyRole = () => mockMembers.find((m) => m.isYou)?.role ?? 'member';
const mockFailIf = (name: string) => {
  mockCalls.push(name);
  if (mockFail[name]) throw mockFail[name];
};

jest.mock('@/lib/api', () => ({
  ApiError: jest.requireActual('@/lib/api-error').ApiError,
  fetchMe: async () => ({
    user: { id: mockMeId, email: 'me@example.com' },
    memberships: mockMembers.some((m) => m.isYou) ? [{ householdId: mockH, householdName: 'Dela Cruz', role: mockMyRole() }] : [],
  }),
  fetchHousehold: async () => ({ id: mockH, name: 'Dela Cruz', currency: 'PHP', timezone: 'Asia/Manila', defaultMonthlyBudgetMinor: 100, role: mockMyRole() }),
  updateHousehold: async () => ({}),
  deleteHousehold: async () => {},
  fetchMembers: async () => {
    mockFailIf('fetchMembers');
    return mockMembers.map((m) => ({ ...m }));
  },
  changeMemberRole: async (_t: unknown, _h: string, userId: string, role: Role) => {
    mockFailIf('changeMemberRole');
    mockMembers = mockMembers.map((m) => (m.userId === userId ? { ...m, role } : m));
  },
  removeMember: async (_t: unknown, _h: string, userId: string) => {
    mockFailIf('removeMember');
    mockMembers = mockMembers.filter((m) => m.userId !== userId);
  },
  transferOwnership: async (_t: unknown, _h: string, userId: string) => {
    mockFailIf('transferOwnership');
    mockMembers = mockMembers.map((m) => (m.userId === userId ? { ...m, role: 'owner' } : m.role === 'owner' ? { ...m, role: 'co_owner' } : m));
  },
  fetchInvites: async () => {
    mockFailIf('fetchInvites');
    return mockInvites.map((i) => ({ ...i }));
  },
  createInvite: async (_t: unknown, _h: string, input: { email: string; role: 'co_owner' | 'member' }) => {
    mockFailIf('createInvite');
    const invite = { id: `i${mockInvites.length + 1}`.padEnd(24, '0'), ...input, expiresAt: '2026-12-02T02:00:00.000Z' };
    mockInvites = [invite, ...mockInvites.filter((i) => i.email !== input.email)];
    return { invite, token: mockToken };
  },
  reissueInvite: async (_t: unknown, _h: string, id: string) => {
    mockFailIf('reissueInvite');
    const old = mockInvites.find((i) => i.id === id)!;
    return { invite: old, token: 'R'.repeat(43) };
  },
  revokeInvite: async (_t: unknown, _h: string, id: string) => {
    mockFailIf('revokeInvite');
    mockInvites = mockInvites.filter((i) => i.id !== id);
  },
}));

function setup(role: Role) {
  const others: M[] = [
    { userId: BEN, name: 'Ben Santos', email: 'ben@example.com', role: 'co_owner', joinedAt: '2026-02-01T00:00:00.000Z', isYou: false },
    { userId: CARA, name: null, email: 'cara@example.com', role: 'member', joinedAt: '2026-03-01T00:00:00.000Z', isYou: false },
  ];
  const me: M = { userId: mockMeId, name: 'Me Myself', email: 'me@example.com', role, joinedAt: '2026-01-01T00:00:00.000Z', isYou: true };
  // Exactly one House Owner: if I'm not it, Ben is.
  if (role !== 'owner') others[0] = { ...others[0]!, role: 'owner' };
  if (role === 'co_owner') others[1] = { ...others[1]!, role: 'member' };
  mockMembers = [me, ...others];
  mockInvites = [{ id: 'f'.repeat(24), email: 'pending@example.com', role: 'member', expiresAt: '2026-12-01T02:00:00.000Z' }];
}

beforeEach(() => {
  mockFail = {};
  mockCalls.length = 0;
  mockShare.mockClear();
});

async function open(role: Role) {
  setup(role);
  await renderRouter(
    {
      _layout: () => (
        <HouseholdProvider>
          <Stack />
        </HouseholdProvider>
      ),
      index: () => <Text>Home screen</Text>,
      household: HouseholdScreen,
    },
    { initialUrl: '/household' },
  );
  await screen.findByText('Members');
  await screen.findByText('Me Myself');
}

const rows = () => screen.getAllByTestId('member-row');
const row = (name: string) => rows().find((r) => within(r).queryByText(name))!;

describe('Members: what each role sees', () => {
  it('lists everyone, House Owner first with a "House Owner" badge, and marks you', async () => {
    await open('co_owner');
    const names = rows().map((r) => within(r).queryAllByText(/Ben Santos|Me Myself|cara@example.com/)[0]?.props.children);
    expect(names.slice(0, 3)).toEqual(['Ben Santos', 'Me Myself', 'cara@example.com']);
    expect(within(row('Ben Santos')).getByText('House Owner')).toBeTruthy();
    expect(within(row('Me Myself')).getByText('(you)')).toBeTruthy();
  });

  it('House Owner: change role, make House Owner and remove on others; no Leave', async () => {
    await open('owner');
    expect(screen.getByLabelText('Make House Member: Ben Santos')).toBeTruthy();
    expect(screen.getByLabelText('Make Co-Owner: cara@example.com')).toBeTruthy();
    expect(screen.getByLabelText('Make House Owner: Ben Santos')).toBeTruthy();
    expect(screen.getByLabelText('Remove cara@example.com')).toBeTruthy();
    expect(within(row('Me Myself')).queryByRole('button')).toBeNull();
    expect(screen.queryByText('Leave household')).toBeNull();
    expect(screen.getByText('To leave this household, first make someone else the House Owner.')).toBeTruthy();
  });

  it('Co-Owner: manages others but never the House Owner; cannot transfer; can leave', async () => {
    await open('co_owner');
    expect(within(row('Ben Santos')).queryByRole('button')).toBeNull(); // the House Owner
    expect(screen.getByLabelText('Make Co-Owner: cara@example.com')).toBeTruthy();
    expect(screen.getByLabelText('Remove cara@example.com')).toBeTruthy();
    expect(screen.queryByLabelText(/^Make House Owner/)).toBeNull();
    expect(screen.getByText('Leave household')).toBeTruthy();
  });

  it('House Member: read-only list, no invite section, only Leave', async () => {
    await open('member');
    for (const name of ['Ben Santos', 'cara@example.com']) expect(within(row(name)).queryByRole('button')).toBeNull();
    expect(screen.queryByText('Invite someone')).toBeNull();
    expect(mockCalls).not.toContain('fetchInvites');
    expect(screen.getByText('Leave household')).toBeTruthy();
  });
});

describe('Members: actions', () => {
  it('changing a role updates the list', async () => {
    await open('owner');
    await fireEvent.press(screen.getByLabelText('Make Co-Owner: cara@example.com'));
    await screen.findByText('cara@example.com is now a Co-Owner.');
    await waitFor(() => expect(within(row('cara@example.com')).getByText('Co-Owner')).toBeTruthy());
  });

  it('remove asks first; Cancel keeps them, Remove removes them', async () => {
    await open('owner');
    await fireEvent.press(screen.getByLabelText('Remove cara@example.com'));
    expect(screen.getByText('Remove cara@example.com from Dela Cruz?')).toBeTruthy();
    await fireEvent.press(screen.getByText('Cancel'));
    expect(mockCalls).not.toContain('removeMember');

    await fireEvent.press(screen.getByLabelText('Remove cara@example.com'));
    await fireEvent.press(within(row('cara@example.com')).getByText('Remove'));
    await screen.findByText('cara@example.com was removed.');
    await waitFor(() => expect(screen.queryAllByText('cara@example.com')).toHaveLength(0));
  });

  it('a failed action says so and changes nothing', async () => {
    await open('owner');
    mockFail.changeMemberRole = new TypeError('Network request failed');
    await fireEvent.press(screen.getByLabelText('Make Co-Owner: cara@example.com'));
    await screen.findByText("That didn't work. Check your connection and try again.");
    expect(within(row('cara@example.com')).getByText('House Member')).toBeTruthy();
  });

  // Regression guard (same class as the stale-budget bug): after handing over
  // ownership, the screen must drop your House Owner controls at once.
  it('transfer ownership asks first, then you become Co-Owner and lose Owner-only controls', async () => {
    await open('owner');
    await fireEvent.press(screen.getByLabelText('Make House Owner: Ben Santos'));
    expect(screen.getByText("Make Ben Santos the House Owner? You'll become a Co-Owner.")).toBeTruthy();
    await act(async () => fireEvent.press(within(row('Ben Santos')).getByText('Make House Owner')));
    await screen.findByText('Ben Santos is now the House Owner.');
    await waitFor(() => expect(screen.getByText('Your role: Co-Owner')).toBeTruthy());
    expect(screen.queryByLabelText('Household name to confirm')).toBeNull(); // delete is Owner-only
    expect(screen.queryByLabelText(/^Make House Owner/)).toBeNull();
    expect(within(row('Ben Santos')).getByText('House Owner')).toBeTruthy();
    expect(screen.getByText('Leave household')).toBeTruthy();
  });

  it('leave asks first, then leaves and goes home', async () => {
    await open('member');
    await fireEvent.press(screen.getByText('Leave household'));
    expect(screen.getByText("Leave Dela Cruz? You'll need a new invite to come back.")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getAllByText('Leave household').at(-1)!));
    await screen.findByText('Home screen');
    expect(mockCalls).toContain('removeMember');
  });

  it('a failed leave says so and stays', async () => {
    await open('member');
    mockFail.removeMember = new TypeError('Network request failed');
    await fireEvent.press(screen.getByText('Leave household'));
    await fireEvent.press(screen.getAllByText('Leave household').at(-1)!);
    await screen.findByText("Couldn't leave the household. Check your connection and try again.");
  });

  it('members mockFailIf to load → Try again recovers', async () => {
    mockFail.fetchMembers = new TypeError('Network request failed');
    setup('owner');
    await renderRouter(
      { _layout: () => (<HouseholdProvider><Stack /></HouseholdProvider>), household: HouseholdScreen },
      { initialUrl: '/household' },
    );
    await screen.findByText("Couldn't load the members.");
    mockFail = {};
    await fireEvent.press(screen.getAllByText('Try again')[0]!);
    await screen.findByText('Me Myself');
  });
});

describe('Invites', () => {
  it('creates an invite (email normalised, chosen role), shares the link and lists it as pending', async () => {
    await open('co_owner');
    await fireEvent.changeText(screen.getByPlaceholderText('name@example.com'), '  New@Example.com ');
    await fireEvent.press(screen.getByLabelText('Co-Owner'));
    await fireEvent.press(screen.getByText('Create invite link'));
    await screen.findByText(`https://bdgtr.erroldee.com/invite/${mockToken}`);
    expect(mockShare).toHaveBeenCalledWith(expect.stringContaining('Dela Cruz'), `https://bdgtr.erroldee.com/invite/${mockToken}`);
    await screen.findByText('new@example.com');
    expect(screen.getByText(/Co-Owner · expires Dec 2/)).toBeTruthy();
  });

  it.each([['', 'Enter a valid email address'], ['not-an-email', 'Enter a valid email address']])(
    'email %j → "%s", nothing sent',
    async (email, message) => {
      await open('owner');
      await fireEvent.changeText(screen.getByPlaceholderText('name@example.com'), email);
      await fireEvent.press(screen.getByText('Create invite link'));
      expect(screen.getByText(message)).toBeTruthy();
      expect(mockCalls).not.toContain('createInvite');
    },
  );

  it.each([
    [new ApiError(409, 'already_member'), 'That person is already a member of this household.'],
    [new ApiError(409, 'invite_limit'), 'Too many pending invites. Revoke some first.'],
    [new TypeError('Network request failed'), "Couldn't create the invite. Check your connection and try again."],
  ])('server says %s → explains it', async (err, message) => {
    await open('owner');
    mockFail.createInvite = err;
    await fireEvent.changeText(screen.getByPlaceholderText('name@example.com'), 'x@example.com');
    await fireEvent.press(screen.getByText('Create invite link'));
    await screen.findByText(message);
    expect(mockShare).not.toHaveBeenCalled();
  });

  it('no share sheet on this browser: the link is copied and says so', async () => {
    mockShare.mockResolvedValueOnce('copied');
    await open('owner');
    await fireEvent.changeText(screen.getByPlaceholderText('name@example.com'), 'x@example.com');
    await fireEvent.press(screen.getByText('Create invite link'));
    await screen.findByText('Link copied. Paste it into a message to send it.');
  });

  it('Share again gets a fresh link and shares it', async () => {
    await open('owner');
    await screen.findByText('pending@example.com');
    await fireEvent.press(screen.getByLabelText('Share a new invite link with pending@example.com'));
    await screen.findByText(`https://bdgtr.erroldee.com/invite/${'R'.repeat(43)}`);
    expect(mockShare).toHaveBeenCalledWith(expect.any(String), `https://bdgtr.erroldee.com/invite/${'R'.repeat(43)}`);
  });

  it('Revoke removes it from the pending list; a failure says so', async () => {
    await open('owner');
    await screen.findByText('pending@example.com');
    mockFail.revokeInvite = new TypeError('Network request failed');
    await fireEvent.press(screen.getByLabelText('Revoke the invite to pending@example.com'));
    await screen.findByText("Couldn't revoke the invite. Try again.");
    expect(screen.getByText('pending@example.com')).toBeTruthy();

    mockFail = {};
    await fireEvent.press(screen.getByLabelText('Revoke the invite to pending@example.com'));
    await screen.findByText('Invite to pending@example.com revoked.');
    await screen.findByText('No pending invites.');
  });
});
