/** Android sign-in (Google via Clerk) and its error messages. */
import { fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import SignInScreen from '@/app/sign-in';
import { clerkErrorCode, signInErrorMessage } from '@/lib/sign-in-error';

let mockAuth = { isLoaded: true, isSignedIn: false };
const mockStartSSOFlow = jest.fn();
jest.mock('@clerk/expo', () => ({ useAuth: () => mockAuth, useSSO: () => ({ startSSOFlow: mockStartSSOFlow }) }));
jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  warmUpAsync: jest.fn(async () => {}),
  coolDownAsync: jest.fn(async () => {}),
}));
jest.mock('expo-auth-session', () => ({ makeRedirectUri: () => 'bdgtr://sso-callback' }));

const mockSetActive = jest.fn(async () => {});

beforeEach(() => {
  mockAuth = { isLoaded: true, isSignedIn: false };
  mockStartSSOFlow.mockReset();
  mockSetActive.mockClear();
});

const open = () =>
  renderRouter({ index: () => <Text>Home screen</Text>, 'sign-in': SignInScreen }, { initialUrl: '/sign-in' });

describe('Sign-in screen', () => {
  it('Google sign-in uses the app return link, activates the session and opens the app', async () => {
    mockStartSSOFlow.mockResolvedValue({ createdSessionId: 'sess_1', setActive: mockSetActive, authSessionResult: { type: 'success' } });
    await open();
    await fireEvent.press(screen.getByLabelText('Continue with Google'));
    expect(mockStartSSOFlow).toHaveBeenCalledWith({ strategy: 'oauth_google', redirectUrl: 'bdgtr://sso-callback' });
    expect(mockSetActive).toHaveBeenCalledWith({ session: 'sess_1' });
    await screen.findByText('Home screen');
  });

  it('a signed-in user goes straight to the app', async () => {
    mockAuth = { isLoaded: true, isSignedIn: true };
    await open();
    await screen.findByText('Home screen');
  });

  it('closing the Google tab (cancel) stays here with no error', async () => {
    mockStartSSOFlow.mockResolvedValue({ createdSessionId: null, setActive: mockSetActive, authSessionResult: { type: 'dismiss' } });
    await open();
    await fireEvent.press(screen.getByLabelText('Continue with Google'));
    expect(mockSetActive).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Continue with Google')).toBeTruthy();
  });

  // Regression: production rejected the app's return link and the screen only said
  // "Sign-in didn't complete", so the cause had to be found by hand.
  it("a Clerk rejection shows Clerk's reason code", async () => {
    mockStartSSOFlow.mockRejectedValue({ errors: [{ code: 'resource_missmatch', message: 'redirect url…' }] });
    await open();
    await fireEvent.press(screen.getByLabelText('Continue with Google'));
    expect(await screen.findByText(/the reason is: resource_missmatch/)).toBeTruthy();
    expect(screen.getByLabelText('Continue with Google')).toBeTruthy(); // can try again
  });

  it('a network failure asks to check the connection', async () => {
    mockStartSSOFlow.mockRejectedValue(new TypeError('Network request failed'));
    await open();
    await fireEvent.press(screen.getByLabelText('Continue with Google'));
    expect(await screen.findByText("Sign-in didn't complete. Check your connection and try again.")).toBeTruthy();
  });

  it('the button is disabled until Clerk has loaded', async () => {
    mockAuth = { isLoaded: false, isSignedIn: false };
    await open();
    await fireEvent.press(screen.getByLabelText('Continue with Google'));
    expect(mockStartSSOFlow).not.toHaveBeenCalled();
  });
});

describe('clerkErrorCode', () => {
  it.each([
    [{ errors: [{ code: 'resource_missmatch' }] }, 'resource_missmatch'],
    [{ code: 'network_error' }, 'network_error'],
  ])('reads the code from %j', (err, code) => {
    expect(clerkErrorCode(err)).toBe(code);
  });

  it.each([
    ['no code', new Error('boom')],
    ['not an object', 'oops'],
    ['null', null],
    ['empty errors list', { errors: [] }],
    ['code with spaces/markup (could be anything)', { errors: [{ code: '<b>ana@example.com</b>' }] }],
    ['overlong code', { code: 'x'.repeat(61) }],
    ['non-string code', { code: 42 }],
  ])('ignores %s', (_label, err) => {
    expect(clerkErrorCode(err)).toBeNull();
    expect(signInErrorMessage(err)).toBe("Sign-in didn't complete. Check your connection and try again.");
  });
});
