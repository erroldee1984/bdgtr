/* bdgtr service worker: Web Push notifications (docs/PLAN.md §2b).
 * Shows budget alerts as system notifications, even with no tab open. If the
 * app is open and in front, it passes the alert to the page (shown as an
 * in-app toast) instead of a duplicate system notification.
 * No caching here: offline support is future work (§15). */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  if (!data || data.type !== 'alert' || typeof data.title !== 'string') return;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const inFront = windows.find((w) => w.focused && w.visibilityState === 'visible');
      if (inFront) {
        inFront.postMessage({ type: 'bdgtr-alert', alert: data });
        return;
      }
      await self.registration.showNotification(data.title, {
        body: data.body,
        tag: data.tag,
        renotify: true,
        icon: '/notification-icon.png',
        badge: '/notification-badge.png',
        data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/alerts' },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data && event.notification.data.url ? event.notification.data.url : '/alerts';
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        if ('navigate' in existing) await existing.navigate(target);
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
