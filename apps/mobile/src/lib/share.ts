import { Platform, Share } from 'react-native';

export type ShareOutcome = 'shared' | 'copied' | 'dismissed' | 'unavailable';

/**
 * Shares an invite link: the Android share sheet (Messenger, Viber, SMS,
 * email…), or on the web the browser's share sheet where there is one,
 * otherwise the clipboard. Never throws; the caller always also shows the
 * link as selectable text, so 'unavailable' still leaves a way to copy it.
 */
export async function shareLink(message: string, url: string): Promise<ShareOutcome> {
  if (Platform.OS !== 'web') {
    try {
      const result = await Share.share({ message: `${message}\n${url}` });
      return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
    } catch {
      return 'unavailable';
    }
  }
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  if (nav?.share) {
    try {
      await nav.share({ text: message, url });
      return 'shared';
    } catch (err) {
      // The person closed the sheet: not an error.
      if ((err as { name?: string })?.name === 'AbortError') return 'dismissed';
    }
  }
  try {
    await nav?.clipboard?.writeText(url);
    return nav?.clipboard ? 'copied' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
