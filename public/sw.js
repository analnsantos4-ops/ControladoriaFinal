// Service Worker PWA Offline-First para Controladoria / Blitz de Validade
const CACHE_NAME = 'controladoria-cache-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/style.css',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/favicon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Pre-caching parcial:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Não intercepta requisições de métodos não-GET (POST, PUT, DELETE do Supabase etc.)
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Não intercepta chamadas à API do Supabase no service worker (o IndexedDB gerencia a fila offline)
  if (url.hostname.includes('supabase.co')) {
    return;
  }

  // Navegação HTML: Network first com fallback para o cache do app shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match('/index.html').then((cached) => {
            return cached || caches.match('/');
          });
        })
    );
    return;
  }

  // Recursos estáticos (scripts, estilos, ícones, imagens locais): Stale-while-revalidate / Cache first
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Em caso de falha de rede e sem cache
          return null;
        });

      return cachedResponse || fetchPromise;
    })
  );
});
