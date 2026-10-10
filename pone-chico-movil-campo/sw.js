// Service worker de Pone Chico Campo — cachea solo la app shell (este HTML,
// el manifest, los iconos y las librerias externas que usa) para que abra
// offline. Nunca intercepta nada mas: ni las teselas del mapa (arcgisonline)
// ni las llamadas a Supabase (sincronizacion), asi no hay riesgo de servir
// datos viejos ni de romper la sincronizacion.
//
// 8/10/2026 (auditoria de Campo): antes la precarga usaba cache.addAll() con
// "https://fonts.googleapis.com" pelado en la lista; esa URL siempre falla,
// addAll es todo-o-nada y el catch lo tapaba, asi que NUNCA se guardaba el
// HTML y sin senal Chrome mostraba "sin internet". Ademas la apertura de la
// app (navegacion a la carpeta) no coincidia con ningun item de la lista, y
// cada sw.js borraba las caches de las OTRAS apps (comparten origen).
const CACHE = 'pone-chico-movil-simple-v1.40';
const PRECACHE_URLS = [".","index.html","manifest.json","icon-48x48.png","icon-72x72.png","icon-96x96.png","icon-144x144.png","icon-192x192.png","icon-512x512.png","https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js","https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js","https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css","https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js","https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap"];
// Prefijo de las caches de ESTA app ("la-vuelta-movil-v", "la-vuelta-movil-simple-v"...).
// Las 10 apps comparten origen: solo se borran las caches propias de versiones viejas.
const PREFIJO = CACHE.replace(/[0-9.]+$/, '');

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => Promise.all(
      // de a uno: si una URL falla, las demas igual se guardan
      PRECACHE_URLS.map(u => cache.add(u).catch(()=>{}))
    )).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE && k.startsWith(PREFIJO)).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return; // nunca tocar POST (sincronizacion con Supabase)
  const url = req.url;
  const esApertura = req.mode === 'navigate' && url.startsWith(self.registration.scope);
  const enLista = esApertura || PRECACHE_URLS.some(u => url.endsWith(u) || url === u);
  if (!enLista) return; // deja pasar todo lo demas (Supabase, teselas del mapa, etc.)
  event.respondWith(
    // La apertura de la app se sirve siempre con el index.html guardado, venga con ?parametros o sin ellos
    caches.match(esApertura ? new Request(self.registration.scope + 'index.html') : req, {ignoreSearch: esApertura}).then(cached => {
      const network = fetch(req).then(resp => {
        if (resp && resp.status === 200 && !esApertura) {
          const copy = resp.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        } else if (resp && resp.status === 200 && esApertura) {
          const copy = resp.clone();
          caches.open(CACHE).then(cache => cache.put(self.registration.scope + 'index.html', copy));
        }
        return resp;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
