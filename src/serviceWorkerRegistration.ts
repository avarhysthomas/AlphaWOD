// src/serviceWorkerRegistration.ts
// Based on CRA’s default service worker setup

export function register() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/service-worker.js')
          .then(registration => {
            console.log(' ServiceWorker registered: ', registration);
          })
          .catch(error => {
            console.error(' ServiceWorker registration failed:', error);
          });
      });
    }
  }
  