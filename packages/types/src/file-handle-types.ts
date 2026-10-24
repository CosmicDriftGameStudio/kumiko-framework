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

// The `ctx.services.files` service — a factory that materialises a FileHandle for a
// storage key. One per request/event, bound to a single tenant: the provider
// is resolved per-tenant through file-foundation, so uploads, ctx.services.files and the
// GDPR jobs all hit the same store by construction.
export type FileContext = {
  ref(key: string): FileHandle;
  // For a storageKey read from a fileRef row the caller already tenant-checked. `ref` enforces
  // the context's tenant prefix, but a tenant handover moves the row without moving the bytes,
  // so the key keeps the previous tenant's prefix.
  refFromFileRef(row: { readonly storageKey: string }): FileHandle;
  // The row's key plus every key derive() produced from it, under the same trust as
  // refFromFileRef; deleting a handed-over file needs it to reach the derivatives.
  listFromFileRef(row: { readonly storageKey: string }): Promise<readonly string[]>;
  list(prefix: string): Promise<readonly string[]>;
  // The only write path for bytes that a fileRef row will claim: records the key in the upload
  // ledger first, so a crash before the commit leaves something the sweep can find. A plain
  // `ref(key).write()` is not tracked and is never swept (derivatives, exports).
  writeUploadBytes(key: string, data: Uint8Array, mimeType: string): Promise<void>;
  // Drops the ledger entry of bytes that were deleted again without a committed fileRef row.
  forgetUploadBytes(key: string): Promise<void>;
};
