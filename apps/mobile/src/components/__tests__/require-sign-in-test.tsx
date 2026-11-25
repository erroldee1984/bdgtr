import { screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { RequireSignIn } from '../require-sign-in';

let mockAuth = { isLoaded: true, isSignedIn: false };
jest.mock('@clerk/expo', () => ({ useAuth: () => mockAuth }));

function renderApp() {
  return renderRouter(
    {
      index: () => (
        <RequireSignIn>
          <Text>Private dashboard</Text>
        </RequireSignIn>
      ),
      'sign-in': () => <Text>Sign-in screen</Text>,
    },
    { initialUrl: '/' },
  );
}

describe('RequireSignIn', () => {
  it('shows the protected screen to a signed-in user', async () => {
    mockAuth = { isLoaded: true, isSignedIn: true };
    await renderApp();
    expect(screen.getByText('Private dashboard')).toBeTruthy();
  });

  it('sends a signed-out user to /sign-in and never renders the protected content', async () => {
    mockAuth = { isLoaded: true, isSignedIn: false };
    await renderApp();
    expect(screen.getByText('Sign-in screen')).toBeTruthy();
    expect(screen.queryByText('Private dashboard')).toBeNull();
  });

  it('shows a loading indicator (not the content, not a redirect) while the session restores', async () => {
    mockAuth = { isLoaded: false, isSignedIn: false };
    await renderApp();
    expect(screen.getByLabelText('Loading')).toBeTruthy();
    expect(screen.queryByText('Private dashboard')).toBeNull();
    expect(screen.queryByText('Sign-in screen')).toBeNull();
  });
});
