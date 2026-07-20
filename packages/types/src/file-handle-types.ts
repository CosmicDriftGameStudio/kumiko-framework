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
};
