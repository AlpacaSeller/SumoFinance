// ── Service worker PFOS: shell offline ──────────────────────────────────────
// Strategia: network-first per le navigazioni (fallback alla shell in cache),
// cache-first per gli asset statici. Le API (/api/*) non vengono mai cachate
// qui: hanno già cache applicative dedicate (IndexedDB + cache server).

const CACHE = "pfos-shell-v3";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

// NON chiamiamo skipWaiting in install: il nuovo SW resta "waiting" finché
// l'utente non conferma l'aggiornamento (l'app invia SKIP_WAITING dal toast).
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // mai cachare le API qui

  // navigazioni: network-first con cache PER PAGINA (offline apri la pagina
  // che avevi visitato, non sempre la dashboard) e fallback finale alla shell
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(url.pathname, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches
            .match(url.pathname)
            .then((res) => res || caches.match("/"))
            .then((res) => res || Response.error())
        )
    );
    return;
  }

  // asset statici: cache-first
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((res) => {
          if (res.ok && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/"))) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
          }
          return res;
        })
    )
  );
});
