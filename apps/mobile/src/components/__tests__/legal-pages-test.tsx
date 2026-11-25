import { screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import PrivacyScreen from '@/app/privacy';
import TermsScreen from '@/app/terms';
import { CONTACT_EMAIL } from '@/components/legal-page';

function renderAt(url: string) {
  return renderRouter({ index: () => null, privacy: PrivacyScreen, terms: TermsScreen }, { initialUrl: url });
}

describe('public legal pages', () => {
  it('privacy policy covers what Google and users need: data, providers, deletion, contact', async () => {
    await renderAt('/privacy');
    expect(screen.getByRole('heading', { name: 'Privacy Policy' })).toBeTruthy();
    for (const heading of ['What we collect', 'Who can see it', 'Keeping and deleting your data', 'Your rights']) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
    expect(screen.getAllByText(new RegExp(CONTACT_EMAIL)).length).toBeGreaterThan(0);
    expect(screen.getByText(/Clerk \(sign-in\), MongoDB Atlas \(database\)/)).toBeTruthy();
  });

  it('terms of service render with a contact', async () => {
    await renderAt('/terms');
    expect(screen.getByRole('heading', { name: 'Terms of Service' })).toBeTruthy();
    expect(screen.getByText(new RegExp(`Questions about these terms: ${CONTACT_EMAIL}`))).toBeTruthy();
  });

  it('each page links to the other and back to the app', async () => {
    await renderAt('/privacy');
    expect(screen.getByText('Terms')).toBeTruthy();
    expect(screen.getByText('← bdgtr')).toBeTruthy();
  });
});
