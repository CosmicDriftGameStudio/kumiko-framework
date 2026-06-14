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

import type { FileStorageProvider } from "./types";

export type FileHandle = {
  readonly key: string;
  read(): Promise<Uint8Array>;
  write(data: Uint8Array, mimeType?: string): Promise<void>;
  delete(): Promise<void>;
  exists(): Promise<boolean>;
  // Produce a handle for a derived key (e.g. a thumbnail). Does not touch
  // storage; only computes the key. Writing to the derived handle is the
  // caller's job.
  derive(suffix: string): FileHandle;
};

// The `ctx.files` service — a factory that materialises a FileHandle for a
// storage key. One per app, wrapped around whichever FileStorageProvider the
// app boot registered.
export type FileContext = {
  ref(key: string): FileHandle;
};

export function createFileHandle(key: string, provider: FileStorageProvider): FileHandle {
  return {
    key,
    read: () => provider.read(key),
    write: (data, mimeType) => provider.write(key, data, mimeType),
    delete: () => provider.delete(key),
    exists: () => provider.exists(key),
    derive: (suffix) => createFileHandle(deriveKey(key, suffix), provider),
  };
}

export function createFileContext(provider: FileStorageProvider): FileContext {
  return {
    ref: (key) => createFileHandle(key, provider), // @wrapper-known semantic-alias
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
