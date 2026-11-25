/** shareLink: Android share sheet, or on the web the browser share sheet / clipboard. Never throws. */
import { Platform, Share } from 'react-native';

import { shareLink } from '../share';

const URL = 'https://bdgtr.erroldee.com/invite/x';
const originalOS = Platform.OS;
const nav = globalThis.navigator as unknown as Record<string, unknown>;
const saved = { share: nav.share, clipboard: nav.clipboard };

afterEach(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  Object.assign(nav, saved);
  jest.restoreAllMocks();
});
const onWeb = (share?: unknown, clipboard?: unknown) => {
  Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  nav.share = share;
  nav.clipboard = clipboard;
};

describe('shareLink on Android', () => {
  it('opens the share sheet with the message and link', async () => {
    const spy = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    await expect(shareLink('Join us', URL)).resolves.toBe('shared');
    expect(spy).toHaveBeenCalledWith({ message: `Join us\n${URL}` });
  });

  it('closing the sheet is "dismissed"; a failure is "unavailable" (never throws)', async () => {
    jest.spyOn(Share, 'share').mockResolvedValueOnce({ action: Share.dismissedAction, activityType: undefined });
    await expect(shareLink('Join us', URL)).resolves.toBe('dismissed');
    jest.spyOn(Share, 'share').mockRejectedValueOnce(new Error('no activity'));
    await expect(shareLink('Join us', URL)).resolves.toBe('unavailable');
  });
});

describe('shareLink on the web', () => {
  it('uses the browser share sheet when there is one', async () => {
    const share = jest.fn(async () => {});
    onWeb(share);
    await expect(shareLink('Join us', URL)).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ text: 'Join us', url: URL });
  });

  it('closing the browser sheet is "dismissed", not copied', async () => {
    onWeb(jest.fn(async () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' }))), { writeText: jest.fn() });
    await expect(shareLink('Join us', URL)).resolves.toBe('dismissed');
  });

  it('no share sheet (most desktop browsers): copies the link', async () => {
    const writeText = jest.fn(async () => {});
    onWeb(undefined, { writeText });
    await expect(shareLink('Join us', URL)).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith(URL);
  });

  it('share fails for another reason: falls back to copying', async () => {
    const writeText = jest.fn(async () => {});
    onWeb(jest.fn(async () => Promise.reject(new Error('NotAllowedError'))), { writeText });
    await expect(shareLink('Join us', URL)).resolves.toBe('copied');
  });

  it('neither available, or clipboard blocked: "unavailable" (the link is shown to copy by hand)', async () => {
    onWeb(undefined, undefined);
    await expect(shareLink('Join us', URL)).resolves.toBe('unavailable');
    onWeb(undefined, { writeText: jest.fn(async () => Promise.reject(new Error('denied'))) });
    await expect(shareLink('Join us', URL)).resolves.toBe('unavailable');
  });
});
