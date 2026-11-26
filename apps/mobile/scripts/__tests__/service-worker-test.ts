/// <reference types="node" />
/**
 * The real public/sw.js, run in a sandbox with a fake service-worker global.
 * Covers what a browser does with a pushed budget alert and a tap on it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';

const SOURCE = readFileSync(join(__dirname, '..', '..', 'public', 'sw.js'), 'utf8');

type Handler = (event: Record<string, unknown>) => void;
type FakeWindow = { url: string; focused: boolean; visibilityState: string; postMessage: jest.Mock; focus: jest.Mock; navigate: jest.Mock };

function load(windows: FakeWindow[] = []) {
  const handlers: Record<string, Handler> = {};
  const showNotification = jest.fn(async () => {});
  const openWindow = jest.fn(async () => null);
  const self = {
    location: { origin: 'https://bdgtr.erroldee.com' },
    addEventListener: (type: string, h: Handler) => (handlers[type] = h),
    skipWaiting: jest.fn(),
    registration: { showNotification },
    clients: { matchAll: jest.fn(async () => windows), openWindow, claim: jest.fn(async () => {}) },
  };
  runInContext(SOURCE, createContext({ self, URL }));
  /** Fires an event and waits for its waitUntil work. */
  const fire = async (type: string, event: Record<string, unknown>) => {
    let work: Promise<unknown> = Promise.resolve();
    handlers[type]!({ ...event, waitUntil: (p: Promise<unknown>) => (work = p) });
    await work;
  };
  return { fire, showNotification, openWindow };
}

const ALERT = {
  type: 'alert',
  title: 'Over budget · Groceries',
  body: 'Dela Cruz household is over its ₱1,000 Groceries budget by ₱100',
  level: 'over',
  householdId: 'h1',
  url: '/alerts?household=h1',
  tag: 'alert-h1-c1',
};
const pushed = (data: unknown) => ({ data: { json: () => (typeof data === 'string' ? JSON.parse(data) : data) } });
const win = (over: Partial<FakeWindow> = {}): FakeWindow => ({
  url: 'https://bdgtr.erroldee.com/',
  focused: false,
  visibilityState: 'hidden',
  postMessage: jest.fn(),
  focus: jest.fn(async () => {}),
  navigate: jest.fn(async () => {}),
  ...over,
});

describe('service worker: a pushed alert', () => {
  it('no app open → a system notification (title, body, tag so it replaces the last one, link)', async () => {
    const { fire, showNotification } = load();
    await fire('push', pushed(ALERT));
    expect(showNotification).toHaveBeenCalledWith(ALERT.title, {
      body: ALERT.body,
      tag: ALERT.tag,
      renotify: true,
      icon: '/notification-icon.png',
      badge: '/notification-badge.png',
      data: { url: '/alerts?household=h1' },
    });
  });

  it('app open in a background tab → still a system notification', async () => {
    const tab = win();
    const { fire, showNotification } = load([tab]);
    await fire('push', pushed(ALERT));
    expect(showNotification).toHaveBeenCalled();
    expect(tab.postMessage).not.toHaveBeenCalled();
  });

  it('app open and in front → handed to the page (shown as a toast), no duplicate system notification', async () => {
    const tab = win({ focused: true, visibilityState: 'visible' });
    const { fire, showNotification } = load([tab]);
    await fire('push', pushed(ALERT));
    expect(tab.postMessage).toHaveBeenCalledWith({ type: 'bdgtr-alert', alert: ALERT });
    expect(showNotification).not.toHaveBeenCalled();
  });

  it.each([
    ['not JSON', { data: { json: () => { throw new SyntaxError('x'); } } }],
    ['no data', { data: null }],
    ['another type', pushed({ ...ALERT, type: 'spam' })],
    ['no title', pushed({ ...ALERT, title: undefined })],
  ])('ignores a push with %s', async (_label, event) => {
    const { fire, showNotification } = load();
    await fire('push', event as Record<string, unknown>);
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('a link that is not a path on this site falls back to /alerts', async () => {
    const { fire, showNotification } = load();
    await fire('push', pushed({ ...ALERT, url: 'https://evil.example.com/' }));
    expect((showNotification.mock.calls[0] as unknown[])[1]).toMatchObject({ data: { url: '/alerts' } });
  });
});

describe('service worker: tapping the notification', () => {
  const click = (url = '/alerts?household=h1') => ({ notification: { close: jest.fn(), data: { url } } });

  it('focuses an open bdgtr tab and takes it to the alerts', async () => {
    const tab = win();
    const { fire, openWindow } = load([tab]);
    const event = click();
    await fire('notificationclick', event);
    expect(event.notification.close).toHaveBeenCalled();
    expect(tab.focus).toHaveBeenCalled();
    expect(tab.navigate).toHaveBeenCalledWith('https://bdgtr.erroldee.com/alerts?household=h1');
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('no tab open → opens one at the alerts', async () => {
    const { fire, openWindow } = load([]);
    await fire('notificationclick', click());
    expect(openWindow).toHaveBeenCalledWith('https://bdgtr.erroldee.com/alerts?household=h1');
  });
});
