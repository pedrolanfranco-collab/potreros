// Service worker de La Vuelta — cachea solo la app shell (este HTML,
// el manifest, los iconos y las librerias externas que usa) para que abra
// offline. Nunca intercepta nada mas: ni las teselas del mapa (arcgisonline)
// ni las llamadas a Supabase (sincronizacion), asi no hay riesgo de servir
// datos viejos ni de romper la sincronizacion.
const CACHE = 'la-vuelta-movil-v2.18';
const PRECACHE_URLS = [".", "index.html", "manifest.json", "icon-48x48.png", "icon-72x72.png", "icon-96x96.png", "icon-144x144.png", "icon-192x192.png", "icon-512x512.png", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js", "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js", "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css", "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js", "https://fonts.googleapis.com", "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap"];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(PRECACHE_URLS)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return; // nunca tocar POST (sincronizacion con Supabase)
  const url = req.url;
  const enLista = PRECACHE_URLS.some(u => url.endsWith(u) || url === u);
  if (!enLista) return; // deja pasar todo lo demas (Supabase, teselas del mapa, etc.)
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(resp => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return resp;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
