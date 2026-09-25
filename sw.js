// Service worker mínimo: permite instalar la aplicación y abrirla sin conexión.
// Estrategia "red primero": siempre se intenta traer la versión nueva; la caché
// solo se usa si no hay conexión. Los datos (Supabase) NUNCA se guardan acá.
const CACHE = 'planificacion-v1';
const SHELL = [
  '/', '/index.html', '/css/app.css', '/manifest.webmanifest',
  '/js/app.js', '/js/db.js', '/js/engine.js', '/js/excel.js', '/js/legacy.js', '/js/ui.js', '/js/detalle.js',
  '/js/modules/resumen.js', '/js/modules/planificacion.js', '/js/modules/personas.js',
  '/js/modules/riesgos.js', '/js/modules/evolucion.js', '/js/modules/carga.js',
  '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html'))),
  );
});
