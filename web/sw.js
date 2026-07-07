"use strict";
// App-shell = cache-first (offline). data.json = stale-while-revalidate
// (update data nyampe otomatis saat online, tanpa rebuild APK). Lihat spec Bagian 14.
const CACHE = "jt-v6"; // bump HANYA kalau app-shell (html/js/css) berubah
const SHELL = ["./", "./index.html", "./router.js", "./suggest.js", "./legs.js", "./livenav.js", "./app.js", "./manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.endsWith("data.json")) {
    // stale-while-revalidate
    e.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(e.request).then((cached) => {
          const net = fetch(e.request).then((res) => {
            if (res && res.ok) cache.put(e.request, res.clone());
            return res;
          }).catch(() => cached);
          return cached || net;
        })
      )
    );
    return;
  }
  // app-shell: cache-first
  e.respondWith(caches.match(e.request).then((c) => c || fetch(e.request)));
});
