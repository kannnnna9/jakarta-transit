"use strict";
// App-shell = network-first (online selalu fresh, offline fallback cache).
// data.json = stale-while-revalidate. Update app-shell (router/app/dll) nyampe
// otomatis tiap online tanpa clear cache manual / regen APK. Lihat spec Bagian 14.
const CACHE = new URL(self.location.href).searchParams.get("cache") || "jt-v19";
const SHELL = ["./", "./index.html", "./router.js", "./suggest.js", "./legs.js", "./livenav.js", "./cost.js", "./app.js", "./manifest.json"];

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
  // app-shell: network-first (online fresh, offline fallback cache).
  // Segarkan cache tiap sukses supaya offline juga dapat versi terbaru.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
