// FileHandle — a thin pointer-object around a storage key.
//
// The contract the framework exposes to hook/handler code: a FileHandle lets
// you read/write/delete the binary behind a storage key without ever passing
// the binary through event payloads, job queues, or hook signatures. Events
// carry the key, hooks reach for `ctx.files.ref(key)` when they actually need
// the bytes, and big files stay in the storage layer where they belong.
//
// `derive(suffix)` is the primitive for thumbnail/variant keys: it inserts a
// suffix before the file extension — `foo/bar.jpg` + `"medium"` →
// `foo/bar.medium.jpg`. Stable, reversible, no extra lookup tables.

import type { FileContext, FileHandle } from "@cosmicdrift/kumiko-types/file-handle-types";
import type { FileStorageProvider } from "./types";

export type { FileContext, FileHandle };

// `getProvider` is a lazily-resolved, memoized accessor — the provider is
// resolved (config + s3.secretAccessKey secret read) only when a handle method
// actually does I/O, never on every request that merely builds a ctx.
export function createFileHandle(
  key: string,
  getProvider: () => Promise<FileStorageProvider>,
): FileHandle {
  return {
    key,
    read: async () => (await getProvider()).read(key),
    write: async (data, mimeType) => (await getProvider()).write(key, data, mimeType),
    delete: async () => (await getProvider()).delete(key),
    exists: async () => (await getProvider()).exists(key),
    derive: (suffix) => createFileHandle(deriveKey(key, suffix), getProvider),
  };
}

// `resolve` is a tenant-bound thunk (the caller binds the tenant). The result
// is memoized for this FileContext's lifetime and shared across every handle it
// produces — never a process-global cache, since each FileContext is bound to a
// single request/event tenant; sharing would leak one tenant's provider (and
// its bucket/credentials) to another.
export function createFileContext(resolve: () => Promise<FileStorageProvider>): FileContext {
  let cached: Promise<FileStorageProvider> | undefined;
  const getProvider = () => {
    cached ??= resolve();
    return cached;
  };
  return {
    ref: (key) => createFileHandle(key, getProvider),
  };
}

// Inserts a suffix before the file extension. Keys without an extension get
// the suffix appended with a dot: `foo/bar` + `"small"` → `foo/bar.small`.
// Keys with a dot earlier in the path (e.g. `archive.v2/foo.jpg`) correctly
// split on the LAST segment only.
export function deriveKey(key: string, suffix: string): string {
  const lastSlash = key.lastIndexOf("/");
  const lastSegment = lastSlash === -1 ? key : key.slice(lastSlash + 1);
  const lastDot = lastSegment.lastIndexOf(".");
  if (lastDot === -1) return `${key}.${suffix}`;
  const prefix = key.slice(0, key.length - lastSegment.length + lastDot);
  const ext = lastSegment.slice(lastDot);
  return `${prefix}.${suffix}${ext}`;
}
