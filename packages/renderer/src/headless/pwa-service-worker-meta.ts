// The server writes this meta into the HTML shell only when the app enables `pwa`, and the
// web client registers the service worker named in its content only when it finds it.
export const PWA_SERVICE_WORKER_META_NAME = "kumiko-pwa-sw";

// CacheStorage is shared by the whole origin, so each base path gets its own prefix to keep one
// app's activation from deleting the precache of another app on the same origin.
export const PWA_CACHE_NAME_PREFIX = "kumiko-pwa-";

export const PWA_CACHE_SCOPE_HASH_LENGTH = 8;

// Must match the prefix the server derives from the shell URL, which equals the worker's scope path.
export async function pwaCacheScopePrefixOf(scopePath: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(scopePath));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${PWA_CACHE_NAME_PREFIX}${hex.slice(0, PWA_CACHE_SCOPE_HASH_LENGTH)}-`;
}
