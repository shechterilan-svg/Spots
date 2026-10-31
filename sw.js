// Spots service worker: precache the app shell; network-first for code so updates show up immediately,
// cache fallback when offline. API calls (Supabase) are never cached here – the app keeps its own data cache.
const VERSION = "spots-v0.4.1";
const SHELL = [
  "./", "index.html", "styles.css", "app.js", "config.js", "lib/db.js", "lib/hours.js", "lib/geo.js", "lib/suggest.js",
  "vendor/supabase-2.118.0.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html")))
  );
});
