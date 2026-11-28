/** bdgtr.erroldee.com/download: the Android app and its install guide (public). */
import { screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import DownloadScreen, { APK_URL, APK_VERSION } from '@/app/download';

import appJson from '../../../app.json';

describe('Download page', () => {
  it('names the version and links to exactly that release’s bdgtr.apk', () => {
    // Exactly the release named on the page (regression: the page didn't say which version you'd get).
    expect(APK_VERSION).toBe(appJson.expo.version);
    expect(APK_URL).toBe(`https://github.com/erroldee1984/bdgtr/releases/download/v${appJson.expo.version}/bdgtr.apk`);
  });

  it('numbered install steps, updating, notifications, and the browser alternative', async () => {
    await renderRouter({ index: () => null, download: DownloadScreen }, { initialUrl: '/download' });
    expect(screen.getByText('Get bdgtr for Android')).toBeTruthy();
    expect(screen.getAllByText(/^[1-4]\.$/).map((t) => t.props.children)).toEqual(['1.', '2.', '3.', '4.']);
    expect(screen.getByText(/Install anyway/)).toBeTruthy();
    expect(screen.getByText(/More → Settings → Turn on notifications/)).toBeTruthy();
    expect(screen.getByText(/Offline mode is only in the Android app/)).toBeTruthy();
  });

  it('the button says which version it downloads', async () => {
    await renderRouter({ index: () => null, download: DownloadScreen }, { initialUrl: '/download' });
    expect(screen.getByLabelText(`Download bdgtr ${APK_VERSION} for Android (bdgtr.apk)`).props.href).toBe(APK_URL);
    expect(screen.getByText(`Download bdgtr ${APK_VERSION}`)).toBeTruthy();
    expect(screen.getByText(/About 21 MB/)).toBeTruthy();
    expect(screen.queryByText(/The first release is being prepared/)).toBeNull();
    expect(screen.getByText(/installs as a separate app next to the old one/)).toBeTruthy();
  });
});
