import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';

import { RequireHousehold } from '../require-household';

const refresh = jest.fn(async () => {});
let mockValue: Record<string, unknown>;
jest.mock('../household-context', () => ({ useHousehold: () => mockValue }));

function renderApp() {
  return renderRouter(
    {
      index: () => (
        <RequireHousehold>
          <Text>Household dashboard</Text>
        </RequireHousehold>
      ),
      onboarding: () => <Text>Create your household</Text>,
    },
    { initialUrl: '/' },
  );
}

const ACTIVE = { householdId: 'h1', householdName: 'Dela Cruz', role: 'owner' };

describe('RequireHousehold', () => {
  it('shows the app when a household is active', async () => {
    mockValue = { state: { status: 'ready' }, active: ACTIVE, refresh };
    await renderApp();
    expect(screen.getByText('Household dashboard')).toBeTruthy();
  });

  it('sends a user with no households to "Create your household"', async () => {
    mockValue = { state: { status: 'ready' }, active: null, refresh };
    await renderApp();
    expect(screen.getByText('Create your household')).toBeTruthy();
    expect(screen.queryByText('Household dashboard')).toBeNull();
  });

  it('shows a spinner (not onboarding, not the app) while loading', async () => {
    mockValue = { state: { status: 'loading' }, active: null, refresh };
    await renderApp();
    expect(screen.getByLabelText('Loading your household')).toBeTruthy();
    expect(screen.queryByText('Create your household')).toBeNull();
  });

  it('on a load error, shows Try again (not onboarding: a network blip must not look like "no household")', async () => {
    mockValue = { state: { status: 'error', error: new Error('offline') }, active: null, refresh };
    await renderApp();
    expect(screen.queryByText('Create your household')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(refresh).toHaveBeenCalled();
  });
});
