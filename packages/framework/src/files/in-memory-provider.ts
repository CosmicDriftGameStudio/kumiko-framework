// In-memory file provider for unit tests. Not for production: nothing
// persists across process restarts, and memory grows with every write.
//
// Factored out of test-files so any package can opt in (samples, downstream
// feature tests) without re-inventing a Map-backed mock.

import type { FileStorageProvider } from "./types.ts";

export type InMemoryFileProvider = FileStorageProvider & {
  // Test-only introspection: keys currently stored. Useful for assertions
  // like `expect(provider.keys()).toContain("tenant/foo.jpg")`.
  keys(): readonly string[];
  // Test-only introspection: the mimeType a write()/writeStream() stored for
  // a key — undefined mirrors an untracked write. FileStorageProvider has no
  // read-back-metadata method (mimeType lives on the FileRef row in prod),
  // so this is the only way a test can assert what actually landed in storage.
  mimeTypeOf(key: string): string | undefined;
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

    async writeStream(key, source, options) {
      // In-memory storage does not provide real streaming; it collects chunks
      // into a Uint8Array. Suitable for tests, not a production path.
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of source) {
        chunks.push(chunk);
        total += chunk.byteLength;
      }
      const data = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        data.set(c, offset);
        offset += c.byteLength;
      }
      store.set(key, { data, mimeType: options?.mimeType });
    },

    async read(key) {
      const entry = store.get(key);
      if (!entry) throw new Error(`in-memory file not found: ${key}`);
      return new Uint8Array(entry.data);
    },

    readStream(key) {
      // In-memory storage has no chunks, but the surface must match real
      // streamers (Local/S3) so test code exercises the same path. Yield the
      // bytes as a single chunk.
      // The O(1) map lookup avoids a cost from eager resolution.
      // Errors are thrown on the first chunk pull, matching S3's lazy pattern
      // (the request starts on the first iterator step).
      const entry = store.get(key);
      const captured = entry ? new Uint8Array(entry.data) : null;
      return {
        async *[Symbol.asyncIterator]() {
          if (captured === null) {
            throw new Error(`in-memory file not found: ${key}`);
          }
          yield captured;
        },
      };
    },

    async delete(key) {
      store.delete(key);
    },

    async exists(key) {
      return store.has(key);
    },

    async list(prefix) {
      return Array.from(store.keys()).filter((key) => key.startsWith(prefix));
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

    mimeTypeOf(key) {
      return store.get(key)?.mimeType;
    },

    clear() {
      store.clear();
    },
  };
}
