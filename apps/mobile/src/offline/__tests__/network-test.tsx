/**
 * Offline hardening (docs/PLAN.md §15, regressions §11): the phone's own
 * connection status fails requests at once, a hung token gives up, online-only
 * More items are disabled offline, the sign-in return link has a screen, and
 * the offline essentials are saved up front.
 */
import NetInfo from '@react-native-community/netinfo';
import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import MoreScreen from '@/app/(tabs)/more';
import SsoCallback from '@/app/sso-callback';
import { apiFetch } from '@/lib/api';
import { isDeviceOffline, OfflineError, setDeviceOffline, tokenWithin } from '@/offline/network';
import { OutboxProvider, useOutbox } from '@/offline/outbox-context';

describe('apiFetch when the phone has no connection', () => {
  afterEach(() => setDeviceOffline(false));

  it('fails at once without asking for a token or calling the server', async () => {
    setDeviceOffline(true);
    const getToken = jest.fn(async () => 't');
    const fetchImpl = jest.fn();
    await expect(apiFetch('/me', getToken, {}, fetchImpl as never)).rejects.toBeInstanceOf(OfflineError);
    expect(getToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('is a TypeError, so the saved-copy and queueing paths treat it as a network failure', () => {
    expect(new OfflineError()).toBeInstanceOf(TypeError);
  });

  it('calls the server again once the connection is back', async () => {
    setDeviceOffline(true);
    setDeviceOffline(false);
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(apiFetch('/me', async () => 't', {}, fetchImpl as never)).resolves.toEqual({ ok: true });
  });
});

describe('tokenWithin', () => {
  it('gives up on a token that never comes (Clerk retrying offline for minutes)', async () => {
    jest.useFakeTimers();
    try {
      const p = tokenWithin(() => new Promise<string>(() => {}), 8_000);
      const check = expect(p).rejects.toBeInstanceOf(OfflineError);
      jest.advanceTimersByTime(8_000);
      await check;
    } finally {
      jest.useRealTimers();
    }
  });

  it('passes a token straight through', async () => {
    await expect(tokenWithin(async () => 'tok')).resolves.toBe('tok');
  });
});

// ── OutboxProvider follows the phone's connection status ──
const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockSecure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockSecure.set(k, v),
}));
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(jest.requireActual('crypto').randomBytes(n)) }));
const mockGetToken = async () => 't';
const mockSignOut = jest.fn();
let mockSignedIn = true;
jest.mock('@clerk/expo', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: mockSignedIn, userId: 'user_a', getToken: mockGetToken }),
  useClerk: () => ({ signOut: mockSignOut }),
}));
jest.mock('@/toast/toast', () => ({ useToast: () => ({ show: () => {} }) }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a) },
  Redirect: ({ href }: { href: string }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text>{`redirect:${href}`}</Text>;
  },
}));
jest.mock('@/components/setup-check', () => ({ SetupCheck: () => null }));


const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function Status() {
  return <Text>{`offline:${useOutbox().offline}`}</Text>;
}
const netListener = () => {
  const calls = (NetInfo.addEventListener as jest.Mock).mock.calls;
  return calls[calls.length - 1]![0] as (s: { isConnected: boolean | null }) => void;
};

describe('connection status', () => {
  afterEach(() => setDeviceOffline(false));

  it('shows offline as soon as the phone loses its connection, and online again when it returns', async () => {
    await render(
      <OutboxProvider>
        <Status />
      </OutboxProvider>,
    );
    await act(async () => {});
    expect(screen.getByText('offline:false')).toBeTruthy();
    await act(async () => netListener()({ isConnected: false }));
    expect(screen.getByText('offline:true')).toBeTruthy();
    expect(isDeviceOffline()).toBe(true);
    await act(async () => netListener()({ isConnected: true }));
    expect(screen.getByText('offline:false')).toBeTruthy();
    expect(isDeviceOffline()).toBe(false);
  });

  it('an unknown status (null) is not treated as offline', async () => {
    await render(
      <OutboxProvider>
        <Status />
      </OutboxProvider>,
    );
    await act(async () => netListener()({ isConnected: null }));
    expect(screen.getByText('offline:false')).toBeTruthy();
  });
});

describe('More tab offline (regression: online-only screens only spun)', () => {
  afterEach(() => setDeviceOffline(false));

  async function mountMore() {
    await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <OutboxProvider>
          <MoreScreen />
        </OutboxProvider>
      </SafeAreaProvider>,
    );
    await act(async () => {});
  }

  it('online: every link opens its screen', async () => {
    await mountMore();
    expect(screen.queryByText('Needs a connection')).toBeNull();
    await act(async () => screen.getByRole('link', { name: 'Settings' }).props.onClick?.());
  });

  it('offline: disables Household, Categories, Fixed transactions, Settings and Sign out; Budgets stays', async () => {
    await mountMore();
    await act(async () => netListener()({ isConnected: false }));
    for (const name of ['Household and members', 'Categories', 'Fixed transactions', 'Settings']) {
      expect(screen.getByRole('link', { name }).props.accessibilityState).toMatchObject({ disabled: true });
    }
    expect(screen.getByRole('link', { name: 'Budgets' }).props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.getAllByText('Needs a connection')).toHaveLength(4);
    expect(screen.getByText('Sign out (needs a connection)')).toBeTruthy();
  });

  it('comes back automatically when the connection returns', async () => {
    await mountMore();
    await act(async () => netListener()({ isConnected: false }));
    await act(async () => netListener()({ isConnected: true }));
    expect(screen.queryByText('Needs a connection')).toBeNull();
    expect(screen.getByRole('link', { name: 'Settings' }).props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.getByText('Sign out')).toBeTruthy();
  });
});

describe('sign-in return link (regression: "page not found" flashed after Google sign-in)', () => {
  afterEach(() => {
    mockSignedIn = true;
  });

  it('goes home once signed in', async () => {
    await render(<SsoCallback />);
    expect(screen.getByText('redirect:/')).toBeTruthy();
  });

  it('waits quietly while the session is being set, then gives up back to sign-in', async () => {
    mockSignedIn = false;
    jest.useFakeTimers();
    try {
      await render(<SsoCallback />);
      expect(screen.queryByText(/redirect:/)).toBeNull();
      await act(async () => jest.advanceTimersByTime(15_000));
      expect(screen.getByText('redirect:/sign-in')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});
