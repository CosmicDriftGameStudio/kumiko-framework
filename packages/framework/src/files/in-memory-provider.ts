// In-memory file provider for unit tests. Not for production: nothing
// persists across process restarts, and memory grows with every write.
//
// Factored out of test-files so any package can opt in (samples, downstream
// feature tests) without re-inventing a Map-backed mock.

import type { FileStorageProvider } from "./types";

export type InMemoryFileProvider = FileStorageProvider & {
  // Test-only introspection: keys currently stored. Useful for assertions
  // like `expect(provider.keys()).toContain("tenant/foo.jpg")`.
  keys(): readonly string[];
  // Test-only reset between cases. beforeEach-friendly.
  clear(): void;
};

type StoredEntry = {
  readonly data: Uint8Array;
  readonly mimeType?: string | undefined;
};

export function createInMemoryFileProvider(): InMemoryFileProvider {
  const store = new Map<string, StoredEntry>();

  return {
    async write(key, data, mimeType) {
      // Copy the buffer so the caller can reuse/mutate theirs without
      // aliasing the stored bytes. Cheap for tests, predictable semantics.
      store.set(key, { data: new Uint8Array(data), mimeType });
    },

    async read(key) {
      const entry = store.get(key);
      if (!entry) throw new Error(`in-memory file not found: ${key}`);
      return new Uint8Array(entry.data);
    },

    async delete(key) {
      store.delete(key);
    },

    async exists(key) {
      return store.has(key);
    },

    // Deterministic fake URL — encodes the key + expiry so tests can assert
    // the route wired through without running a real presigner. Shape
    // (memory://<key>?expires=<seconds>) intentionally differs from any real
    // provider so leakage into production would be obvious at a glance.
    async getSignedUrl(key, expiresInSeconds) {
      return `memory://${key}?expires=${expiresInSeconds}`;
    },

    keys() {
      return Array.from(store.keys());
    },

    clear() {
      store.clear();
    },
  };
}
