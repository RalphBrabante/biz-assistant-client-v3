import { bootstrapApplication } from '@angular/platform-browser';
import { isDevMode } from '@angular/core';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

if (isDevMode() && typeof window !== 'undefined') {
  // Clean up stale service workers/caches from prior production runs on localhost.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        void registration.unregister();
      });
    });
  }
  if ('caches' in window) {
    caches.keys().then((keys) => {
      keys
        .filter((key) => key.startsWith('ngsw:'))
        .forEach((key) => {
          void caches.delete(key);
        });
    });
  }
}

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
