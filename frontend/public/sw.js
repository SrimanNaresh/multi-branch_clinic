// Clean-up service worker. SmartClinic itself does not use a service worker.
// The app that used to run on this domain left one in visitors' browsers, which keeps
// showing its old cached pages. When such a browser checks for an update it gets this
// file instead: it deletes the old caches, removes itself and reloads open tabs.
// The same file is served as sw.js, service-worker.js and serviceWorker.js.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
