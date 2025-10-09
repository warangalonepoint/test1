// service-worker.js
const CACHE = "clinic-pwa-v1";
const ASSETS = [
  "/", "/index.html",
  "/styles.css",
  "/manifest.json",
  "/assets/logo.png", "/assets/banner.png",
  // add key HTML entry points you want available offline:
  "/dashboard.html", "/frontoffice.html", "/supervisor-hub.html",
  "/bookings.html", "/booking-status.html", "/opd-records.html",
  "/lab.html", "/pharmacy.html", "/sales.html", "/purchase.html"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
});

// Cache-first for navigations & static; network-first for JSON API-ish calls
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Network-first for dynamic JSON
  const isJSON = req.headers.get("accept")?.includes("application/json")
              || url.pathname.endsWith(".json");

  if (isJSON) {
    e.respondWith(
      fetch(req).then(r => {
        const clone = r.clone();
        caches.open(CACHE).then(c => c.put(req, clone));
        return r;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Cache-first for everything else
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return r;
    }))
  );
});