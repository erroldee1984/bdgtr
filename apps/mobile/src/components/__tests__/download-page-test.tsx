/** bdgtr.erroldee.com/download: the Android app and its install guide (public). */
import { screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import DownloadScreen, { APK_URL } from '@/app/download';

describe('Download page', () => {
  it('points at the newest GitHub release asset named exactly bdgtr.apk', () => {
    expect(APK_URL).toBe('https://github.com/erroldee1984/bdgtr/releases/latest/download/bdgtr.apk');
  });

  it('numbered install steps, updating, notifications, and the browser alternative', async () => {
    await renderRouter({ index: () => null, download: DownloadScreen }, { initialUrl: '/download' });
    expect(screen.getByText('Get bdgtr for Android')).toBeTruthy();
    expect(screen.getAllByText(/^[1-4]\.$/).map((t) => t.props.children)).toEqual(['1.', '2.', '3.', '4.']);
    expect(screen.getByText(/Install anyway/)).toBeTruthy();
    expect(screen.getByText(/More → Settings → Turn on notifications/)).toBeTruthy();
    expect(screen.getByText(/Offline mode is only in the Android app/)).toBeTruthy();
  });

  it('links to the latest GitHub release (v1.0.0 published 28 Nov 2026)', async () => {
    await renderRouter({ index: () => null, download: DownloadScreen }, { initialUrl: '/download' });
    expect(screen.getByLabelText('Download bdgtr.apk, the Android app').props.href).toBe(APK_URL);
    expect(screen.getByText(/About 21 MB/)).toBeTruthy();
    expect(screen.queryByText(/The first release is being prepared/)).toBeNull();
  });
});
