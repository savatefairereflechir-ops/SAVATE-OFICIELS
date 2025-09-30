const CACHE_NAME = 'savate-officials-v1.0.1'; // Version incrémentée
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/script.js',
  '/browserconfig.xml',
  
  // Icônes pour le manifest et les métadonnées
  '/icons/icon-48x48.png',
  '/icons/icon-72x72.png',
  '/icons/icon-96x96.png',
  '/icons/icon-128x128.png',
  '/icons/icon-144x144.png',
  '/icons/icon-152x152.png',
  '/icons/icon-192x192.png',
  '/icons/icon-384x384.png',
  '/icons/icon-512x512.png',
  
  // Dépendance externe
  'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.4.7/peerjs.min.js'
];

// Installation du Service Worker
self.addEventListener('install', function(event) {
  console.log('Service Worker: Installation en cours...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('Service Worker: Cache ouvert');
        return cache.addAll(urlsToCache);
      })
      .then(function() {
        console.log('Service Worker: Toutes les ressources ont été mises en cache.');
        return self.skipWaiting();
      })
  );
});

// Activation du Service Worker
self.addEventListener('activate', function(event) {
  console.log('Service Worker: Activation en cours...');
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames.map(function(cacheName) {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Suppression ancien cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(function() {
      console.log('Service Worker: Activation terminée');
      return self.clients.claim();
    })
  );
});

// Stratégie "Cache First" pour les ressources statiques
self.addEventListener('fetch', function(event) {
  // Ignorer les requêtes qui ne sont pas des GET
  if (event.request.method !== 'GET') {
    return;
  }

  // Ignorer les requêtes non-HTTP/HTTPS
  if (!event.request.url.startsWith('http')) {
    return;
  }

  // Pour les requêtes de navigation, utiliser une stratégie "Network First"
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(function() {
        return caches.match('/index.html');
      })
    );
    return;
  }

  // Pour toutes les autres requêtes, utiliser "Cache First"
  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        // Cache hit - retourner la réponse du cache
        if (response) {
          return response;
        }

        // Si la ressource n'est pas dans le cache, la récupérer du réseau
        return fetch(event.request).then(function(response) {
          // Ne met en cache que les réponses valides et les ressources de notre domaine
          if (!response || response.status !== 200 || (response.type !== 'basic' && !response.url.includes('cloudflare'))) {
            return response;
          }

          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then(function(cache) {
              cache.put(event.request, responseToCache);
            });

          return response;
        });
      }
    )
  );
});

// ... (le reste du code pour les messages et notifications reste inchangé)

