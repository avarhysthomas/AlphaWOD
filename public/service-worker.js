self.addEventListener('install', event => {
    console.log('[ServiceWorker] Install');
    self.skipWaiting(); // Activate worker immediately
  });
  
  self.addEventListener('activate', event => {
    console.log('[ServiceWorker] Activate');
    return self.clients.claim();
  });
  
  self.addEventListener('fetch', event => {
    event.respondWith(
      caches.match(event.request).then(response => {
        return response || fetch(event.request);
      })
    );
  });
  