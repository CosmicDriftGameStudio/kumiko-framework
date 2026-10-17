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
// storage key. One per request/event, bound to a single tenant: the provider
// is resolved per-tenant through file-foundation, so uploads, ctx.files and the
// GDPR jobs all hit the same store by construction.
export type FileContext = {
  ref(key: string): FileHandle;
  // For a storageKey read from a fileRef row the caller already tenant-checked. `ref` enforces
  // the context's tenant prefix, but a tenant handover moves the row without moving the bytes,
  // so the key keeps the previous tenant's prefix.
  refFromFileRef(row: { readonly storageKey: string }): FileHandle;
  list(prefix: string): Promise<readonly string[]>;
};
