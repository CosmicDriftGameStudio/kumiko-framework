// The server writes this meta into the HTML shell only when the app enables `pwa`, and the
// web client registers the service worker named in its content only when it finds it.
export const PWA_SERVICE_WORKER_META_NAME = "kumiko-pwa-sw";

// CacheStorage is shared by the whole origin, so each base path gets its own prefix to keep one
// app's activation from deleting the precache of another app on the same origin.
export const PWA_CACHE_NAME_PREFIX = "kumiko-pwa-";
