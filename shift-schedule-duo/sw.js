'use strict';

// Filled by tool/prepare_pwa.mjs after Flutter's release build.
const VERSION = '54ae1b45e90afd4c';
const FILES = ["app.js","assets/AssetManifest.bin","assets/AssetManifest.bin.json","assets/FontManifest.json","assets/NOTICES","assets/assets/fonts/NotoSansKR.ttf","assets/assets/fonts/OFL.txt","assets/fonts/MaterialIcons-Regular.otf","assets/packages/cupertino_icons/assets/CupertinoIcons.ttf","assets/shaders/ink_sparkle.frag","assets/shaders/stretch_effect.frag","canvaskit/canvaskit.js","canvaskit/canvaskit.wasm","canvaskit/chromium/canvaskit.js","canvaskit/chromium/canvaskit.wasm","favicon.png","flutter_bootstrap.js","icons/Icon-192.png","icons/Icon-512.png","icons/Icon-maskable-192.png","icons/Icon-maskable-512.png","index.html","main.dart.js","manifest.json","viewport.js"];
const PREFIX = `shift-schedule:${self.registration.scope}:`;
const CACHE = PREFIX + VERSION;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      await cache.addAll(FILES.map(path => new Request(new URL(path, self.registration.scope), {cache: 'reload'})));
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'OFFLINE_STATUS' || !event.ports?.[0]) return;
  event.waitUntil((async () => {
    let ready = false;
    try {
      const cache = await caches.open(CACHE);
      const entries = await Promise.all(FILES.map(path => cache.match(new URL(path, self.registration.scope))));
      ready = FILES.length > 0 && entries.every(Boolean);
    } catch (_) { /* Storage can be unavailable even with an active worker. */ }
    event.ports[0].postMessage({ready});
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (event.request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length);
  const key = event.request.mode === 'navigate' ? 'index.html' : path;
  if (!FILES.includes(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(new URL(key, scope));
    return cached || fetch(event.request);
  })());
});
