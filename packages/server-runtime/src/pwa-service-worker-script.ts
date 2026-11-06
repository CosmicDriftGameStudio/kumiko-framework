// The worker is plain JS in a string because the server hands it out as is: no bundler step,
// no workbox, nothing loaded from outside the app's own origin.

// CacheStorage is shared by the whole origin, so each base path gets its own prefix to keep one
// app's activation from deleting the precache of another app on the same origin.
export const PWA_CACHE_NAME_PREFIX = "kumiko-pwa-";

// Cache names before scoping were `kumiko-pwa-<16hex>`; kept only so an update drops those precaches once.
const UNSCOPED_CACHE_NAME_PATTERN = /^kumiko-pwa-[0-9a-f]{16}$/;

export type PwaServiceWorkerScriptInput = {
  readonly cacheName: string;
  readonly cacheScopePrefix: string;
  readonly precacheUrls: readonly string[];
  readonly shellUrl: string;
  readonly serviceWorkerPath: string;
};

const SERVICE_WORKER_BODY = `
const PASS_THROUGH_PATHS = ["/api", "/sse", "/auth", "/health", "/build-info.json", SERVICE_WORKER_PATH, "/_reload"];
const PASS_THROUGH_PREFIXES = ["/api/", "/sse/", "/auth/"];

function isPassThrough(request, url) {
  if (request.method !== "GET") return true;
  if (url.origin !== self.location.origin) return true;
  if ((request.headers.get("accept") || "").includes("text/event-stream")) return true;
  if (PASS_THROUGH_PATHS.includes(url.pathname)) return true;
  return PASS_THROUGH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

// A redirected response served to a navigation request makes the browser reject it.
function isCacheable(response) {
  return (
    response.ok &&
    response.type === "basic" &&
    !response.redirected &&
    !(response.headers.get("cache-control") || "").includes("no-store")
  );
}

async function storeInCache(request, response) {
  if (!isCacheable(response)) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
}

async function precache() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    PRECACHE_URLS.map(async (url) => {
      try {
        const response = await fetch(new Request(url, { cache: "reload" }));
        if (isCacheable(response)) await cache.put(url, response);
      } catch {
        // One missing file must not block the install; it is cached on first use instead.
      }
    }),
  );
}

async function deleteOldCaches() {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter(
        (name) =>
          (name.startsWith(CACHE_SCOPE_PREFIX) || UNSCOPED_CACHE_NAME_PATTERN.test(name)) &&
          name !== CACHE_NAME,
      )
      .map((name) => caches.delete(name)),
  );
}

async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(SHELL_URL, { ignoreVary: true })) || Response.error();
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    await storeInCache(request, response.clone());
    return response;
  } catch {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(request, { ignoreVary: true })) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  await storeInCache(request, response.clone());
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(deleteOldCaches().then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (isPassThrough(request, url)) return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }
  // Hashed build output never changes under one URL; everything else must not go stale.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (PRECACHE_URLS.includes(url.pathname)) event.respondWith(networkFirst(request));
});
`;

export function buildPwaServiceWorkerScript(input: PwaServiceWorkerScriptInput): string {
  return [
    `const CACHE_SCOPE_PREFIX = ${JSON.stringify(input.cacheScopePrefix)};`,
    `const CACHE_NAME = ${JSON.stringify(input.cacheName)};`,
    `const UNSCOPED_CACHE_NAME_PATTERN = ${UNSCOPED_CACHE_NAME_PATTERN.toString()};`,
    `const SHELL_URL = ${JSON.stringify(input.shellUrl)};`,
    `const SERVICE_WORKER_PATH = ${JSON.stringify(input.serviceWorkerPath)};`,
    `const PRECACHE_URLS = ${JSON.stringify(input.precacheUrls)};`,
    SERVICE_WORKER_BODY,
  ].join("\n");
}
