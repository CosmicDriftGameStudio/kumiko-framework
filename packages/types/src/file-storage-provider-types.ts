// Options for `getSignedUrl`. `contentDisposition` lets the caller hint the
// browser to download-with-name vs inline-display (maps to ResponseContent-
// Disposition on S3). Keep the option-bag small and additive; provider impls
// that don't support a given hint should ignore it rather than error.
export type SignedUrlOptions = {
  readonly contentDisposition?: string;
};

// Options for `writeStream`. `mimeType` is a Content-Type hint analogous to
// `write`. `contentLength` is optional for providers that need a Length
// header (S3 multipart has a TransferManager and can work without it);
// local providers ignore both.
export type WriteStreamOptions = {
  readonly mimeType?: string;
  readonly contentLength?: number;
};

// Primitive storage contract: key+bytes in, bytes out. Metadata (fileName,
// mimeType, size) lives on the FileRef row — the provider only needs to
// shuttle bytes. `mimeType` on write() is a hint for providers that need a
// Content-Type header (S3/R2/…); local filesystems can ignore it.
//
// getSignedUrl is optional — providers without native presigned-URL support
// (filesystem) leave it undefined; the route then returns 501 and the
// client falls back to streaming via GET /files/:id. Callers must
// feature-detect via `typeof provider.getSignedUrl === "function"`.
export type FileStorageProvider = {
  write(key: string, data: Uint8Array, mimeType?: string): Promise<void>;
  writeStream(
    key: string,
    source: AsyncIterable<Uint8Array>,
    options?: WriteStreamOptions,
  ): Promise<void>;
  read(key: string): Promise<Uint8Array>;
  readStream(key: string): AsyncIterable<Uint8Array>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getSignedUrl?(key: string, expiresInSeconds: number, options?: SignedUrlOptions): Promise<string>;
};
