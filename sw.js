// ═══════════════════════════════════════════════════════════
// Guardia Medica — Service Worker
// Strategia: stale-while-revalidate per app shell + font
//            network-only per API Supabase (gestita lato app)
// ═══════════════════════════════════════════════════════════

var CACHE_NAME = 'guardia-medica-v2';
var APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './config.js',
  './favicon.png',
  './manifest.json'
];

// INSTALL: precarica l'app shell
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) { return cache.addAll(APP_SHELL); })
      .then(function() { return self.skipWaiting(); })
  );
});

// MESSAGE: l'app può chiedere al SW di skippare il waiting (per applicare update)
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ACTIVATE: pulisce le cache vecchie
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(names.map(function(name) {
        if (name !== CACHE_NAME) return caches.delete(name);
      }));
    })
  );
});

// FETCH: routing per tipo di richiesta
self.addEventListener('fetch', function(event) {
  // Solo GET
  if (event.request.method !== 'GET') return;

  var url;
  try { url = new URL(event.request.url); }
  catch (e) { return; }

  // Supabase API → SEMPRE network. La app gestisce l'offline via syncQueue.
  // Mai cachare risposte API perché i dati cambiano.
  if (url.hostname.indexOf('supabase.co') !== -1) return;

  // Google s2 favicons (per i link rapidi nav) → cache-first lungo
  if (url.hostname === 'www.google.com' && url.pathname.indexOf('/s2/favicons') === 0) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // Google Fonts → cache-first
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // SheetJS CDN (lazy-load per export Excel) → cache-first
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.indexOf('xlsx') !== -1) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // Supabase JS client (per Realtime) → cache-first
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.indexOf('supabase-js') !== -1) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // Supabase Realtime WebSocket → mai toccare (è WS, non HTTP)
  if (url.protocol === 'wss:' || url.protocol === 'ws:') return;

  // App shell e tutto il resto della stessa origine → stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }
  // Altre origini → lascia passare al network (default browser)
});

// Strategia: ritorna subito dalla cache se disponibile, aggiorna in background.
// Se non in cache: prova network. Se network fallisce: prova cache come fallback.
function staleWhileRevalidate(request) {
  return caches.open(CACHE_NAME).then(function(cache) {
    return cache.match(request).then(function(cached) {
      var networkPromise = fetch(request).then(function(response) {
        if (response && response.ok && response.status === 200) {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(function() {
        // Offline: ritorna cached se c'è, altrimenti errore
        if (cached) return cached;
        // Per richieste di navigazione fallback all'index
        if (request.mode === 'navigate') {
          return cache.match('./index.html');
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      });
      return cached || networkPromise;
    });
  });
}
