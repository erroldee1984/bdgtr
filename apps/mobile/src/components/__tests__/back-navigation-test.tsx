/**
 * Regression: opening or refreshing /household (or /add, or "Create another
 * household") straight from the URL left no way out: there's no history, so
 * the header had no back button and Cancel did nothing.
 *
 * Uses the app's REAL root layout (src/app/_layout.tsx) so the header
 * configuration under test is the one that ships.
 */
import { fireEvent, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import type { ReactNode } from 'react';
import { act } from 'react';
import { Text } from 'react-native';

import RootLayout from '@/app/_layout';
import OnboardingScreen from '@/app/onboarding';

jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));
jest.mock('@clerk/expo', () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: 'u', getToken: async () => 't' }),
}));
jest.mock('@clerk/expo/token-cache', () => ({ tokenCache: {} }));
jest.mock('@/lib/config', () => ({ ...jest.requireActual('@/lib/config'), CLERK_PUBLISHABLE_KEY: 'pk_test_x' }));
jest.mock('@/household/household-context', () => ({
  HouseholdProvider: ({ children }: { children: ReactNode }) => children,
  useHousehold: () => ({
    refresh: async () => {},
    memberships: [{ householdId: 'h1', householdName: 'Home', role: 'owner' }],
    state: { status: 'ready' },
    active: { householdId: 'h1', householdName: 'Home', role: 'owner' },
  }),
}));

const routes = {
  _layout: RootLayout,
  index: () => <Text>Dashboard</Text>,
  household: () => <Text>Household screen</Text>,
  add: () => <Text>Add spend screen</Text>,
  onboarding: OnboardingScreen,
};

describe('a way back from every non-tab screen', () => {
  it.each(['/household', '/add'])('%s opened directly (refresh / typed URL): Back goes to the dashboard', async (url) => {
    await renderRouter(routes, { initialUrl: url });
    await fireEvent.press(screen.getByLabelText('Back'));
    await screen.findByText('Dashboard');
  });

  it('opened from the app: Back returns to where you were', async () => {
    await renderRouter(routes, { initialUrl: '/' });
    await act(async () => router.push('/household'));
    await screen.findByText('Household screen');
    await fireEvent.press(screen.getByLabelText('Back'));
    await screen.findByText('Dashboard');
  });

  it('"Create another household" opened directly: Cancel goes to the dashboard', async () => {
    await renderRouter(routes, { initialUrl: '/onboarding?mode=new' });
    await fireEvent.press(screen.getByText('Cancel'));
    await screen.findByText('Dashboard');
  });
});
