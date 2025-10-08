/* PWA Service Worker — static cache */
const CACHE_VERSION = "v3";  // bump this to force refresh
const CACHE = "clinic-pwa-" + CACHE_VERSION;
const ASSETS = [
  "/", "/index.html",
  "/styles.css", "/config.js", "/db.js",
  "/bookings.html", "/opd.html", "/pharmacy.html",
  "/assets/logo.png", "/assets/banner.png"
];

self.addEventListener("install", (e)=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", (e)=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE && caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", (e)=>{
  const url = new URL(e.request.url);
  if (url.pathname.endsWith(".html") || url.pathname === "/") {
    e.respondWith(fetch(e.request).then(r=>{
      const copy=r.clone(); caches.open(CACHE).then(c=>c.put(e.request, copy));
      return r;
    }).catch(()=>caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit=> hit || fetch(e.request)));
});