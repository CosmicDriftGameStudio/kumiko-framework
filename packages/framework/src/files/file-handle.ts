// FileHandle — a thin pointer-object around a storage key.
//
// The contract the framework exposes to hook/handler code: a FileHandle lets
// you read/write/delete the binary behind a storage key without ever passing
// the binary through event payloads, job queues, or hook signatures. Events
// carry the key, hooks reach for `ctx.files.ref(key)` when they actually need
// the bytes, and big files stay in the storage layer where they belong.
//
// `derive(suffix)` is the primitive for thumbnail/variant keys: it inserts a
// suffix before the file extension — `foo/bar.jpg` + `"medium-<16 hex>"` →
// `foo/bar.medium-<16 hex>.jpg`. The suffix must be a `variantSuffix(...)` so
// the erasure sweep recognizes it. Stable, reversible, no extra lookup tables.

import type { FileContext, FileHandle } from "@cosmicdrift/kumiko-types/file-handle-types";
import type {
  FileProviderResolver,
  FileUploadLedger,
} from "@cosmicdrift/kumiko-types/file-provider-resolver-types";
import { isDerivativeSuffix } from "../derivatives/variant-key.ts";
import type { TenantId } from "../engine/types/identifiers.ts";
import { InternalError } from "../errors/index.ts";
import { assertSafeStorageKey, type FileStorageProvider } from "./types.ts";

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
    derive: (suffix) => {
      // A suffix outside the derivative grammar would write a key that the
      // forget/tenant-destroy sweep (isDerivativeKeyOf) can never recognize,
      // so the binary would survive erasure.
      if (!isDerivativeSuffix(suffix)) {
        throw new Error(
          `FileHandle.derive: suffix "${suffix}" must be <name>-<16 hex chars>; build it with variantSuffix(name, spec)`,
        );
      }
      return createFileHandle(deriveKey(key, suffix), getProvider);
    },
  };
}

// `resolve` is a tenant-bound thunk (the caller binds the tenant). The result
// is memoized for this FileContext's lifetime and shared across every handle it
// produces — never a process-global cache, since each FileContext is bound to a
// single request/event tenant; sharing would leak one tenant's provider (and
// its bucket/credentials) to another.
//
// With `tenantId`, `ref` and `list` only accept keys/prefixes inside `${tenantId}/` —
// the key space is the isolation boundary in a store shared by several tenants, and
// a request-derived key or prefix (or "") would otherwise reach every tenant's keys.
export function createFileContext(
  resolve: () => Promise<FileStorageProvider>,
  tenantId?: string,
  uploadLedger?: FileUploadLedger,
): FileContext {
  let cached: Promise<FileStorageProvider> | undefined;
  const getProvider = () => {
    cached ??= resolve();
    return cached;
  };
  const requireUploadLedger = (): FileUploadLedger => {
    if (uploadLedger === undefined) {
      throw new InternalError({
        message:
          "FileContext: no upload ledger is wired, so upload bytes would be unrecoverable after a crash. Build the context from a resolver made by withFileProviderResolver (or withUploadLedger)",
      });
    }
    return uploadLedger;
  };
  const assertOwnKey = (method: string, key: string): void => {
    if (tenantId !== undefined && !key.startsWith(`${tenantId}/`)) {
      throw new Error(`FileContext.${method}: key must start with "${tenantId}/"`);
    }
  };
  return {
    ref: (key) => {
      assertOwnKey("ref", key);
      return createFileHandle(key, getProvider);
    },
    writeUploadBytes: async (key, data, mimeType) => {
      assertOwnKey("writeUploadBytes", key);
      await requireUploadLedger().record(key);
      await (await getProvider()).write(key, data, mimeType);
    },
    forgetUploadBytes: async (key) => {
      assertOwnKey("forgetUploadBytes", key);
      await requireUploadLedger().forget(key);
    },
    /** Validates only the storage key shape (assertSafeStorageKey), no tenant prefix: keys
     *  may outlive a tenant handover. The caller must ensure the fileRef row came from a
     *  tenant-filtered read. */
    refFromFileRef: (row) => {
      assertSafeStorageKey(row.storageKey);
      return createFileHandle(row.storageKey, getProvider);
    },
    listFromFileRef: async (row) => {
      assertSafeStorageKey(row.storageKey);
      return (await getProvider()).list(storageKeyStemPrefix(row.storageKey));
    },
    list: async (prefix) => {
      if (tenantId !== undefined && !prefix.startsWith(`${tenantId}/`)) {
        throw new Error(`FileContext.list: prefix must start with "${tenantId}/"`);
      }
      return (await getProvider()).list(prefix);
    },
  };
}

// The one way to build a tenant's FileContext from a resolver: carries the resolver's upload
// ledger, so every context agrees on where upload bytes are tracked.
export function createTenantFileContext(
  resolver: FileProviderResolver,
  tenantId: TenantId,
): FileContext {
  return createFileContext(
    () => resolver(tenantId),
    tenantId,
    resolver.uploadLedgerFor?.(tenantId),
  );
}

// Splits a key into the part before the last dot of its last path segment
// (the "stem") and the extension including the dot. No dot in the last
// segment: the whole key is the stem, extension is empty.
function splitKeyExtension(key: string): { readonly stem: string; readonly ext: string } {
  const lastSlash = key.lastIndexOf("/");
  const lastSegment = lastSlash === -1 ? key : key.slice(lastSlash + 1);
  const lastDot = lastSegment.lastIndexOf(".");
  if (lastDot === -1) return { stem: key, ext: "" };
  const stem = key.slice(0, key.length - lastSegment.length + lastDot);
  const ext = lastSegment.slice(lastDot);
  return { stem, ext };
}

// Inserts a suffix before the file extension. Keys without an extension get
// the suffix appended with a dot: `foo/bar` + `"small"` → `foo/bar.small`.
// Keys with a dot earlier in the path (e.g. `archive.v2/foo.jpg`) correctly
// split on the LAST segment only.
export function deriveKey(key: string, suffix: string): string {
  const { stem, ext } = splitKeyExtension(key);
  return ext === "" ? `${key}.${suffix}` : `${stem}.${suffix}${ext}`;
}

// The prefix that covers a key AND every `derive()`d variant of it — `foo/bar.jpg` → `foo/bar.`,
// matching `foo/bar.jpg` and `foo/bar.medium.jpg` alike, since derive() only ever inserts a suffix
// between the stem and the extension. Used by the tenant-handover destroy sweep to reach a moved
// fileRef's original plus every already-rendered derivative, none of which have their own
// `file_refs` row.
export function storageKeyStemPrefix(key: string): string {
  const { stem, ext } = splitKeyExtension(key);
  return ext === "" ? `${key}.` : `${stem}.`;
}
