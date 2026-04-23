self.addEventListener('install', event => {
    console.log('[ServiceWorker] Install');
    self.skipWaiting(); // Activate worker immediately
  });
  
  self.addEventListener('activate', event => {
    console.log('[ServiceWorker] Activate');
    return self.clients.claim();
  });
  
self.addEventListener('fetch', event => {
    const requestUrl = new URL(event.request.url);
    const isSameOrigin = requestUrl.origin === self.location.origin;

    if (event.request.method !== 'GET' || !isSameOrigin) {
      return;
    }

    event.respondWith(
      caches.match(event.request).then(response => {
        return response || fetch(event.request);
      })
    );
  });
  
