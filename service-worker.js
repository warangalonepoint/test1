/* PWA Service Worker — static + runtime cache */
const VERSION = 'v7';
const CACHE = 'clinic-pwa-' + VERSION;

const ASSETS = [
  '/', '/index.html',
  '/manifest.webmanifest',
  '/styles.css',
  '/config/config.js',
  '/scripts/db.js',
  '/scripts/app-wiring.js',
  '/assets/logo.png',
  '/assets/banner.png',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/maskable-512.png'
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.map(k=>k!==CACHE && caches.delete(k))))
  );
  self.clients.claim();
});

/* Network-first for HTML; cache-first for others */
self.addEventListener('fetch', e=>{
  const req = e.request;
  const isHTML = req.destination === 'document' || req.headers.get('accept')?.includes('text/html');
  if (isHTML) {
    e.respondWith(
      fetch(req).then(r=>{
        const copy=r.clone();
        caches.open(CACHE).then(c=>c.put(req, copy));
        return r;
      }).catch(()=>caches.match(req))
    );
  } else {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(r=>{
        if (r.ok && (req.method==='GET')) {
          const copy=r.clone(); caches.open(CACHE).then(c=>c.put(req, copy));
        }
        return r;
      }))
    );
  }
});