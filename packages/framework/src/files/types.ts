import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";

export type FileMetadata = {
  readonly fileName: string;
  readonly mimeType: string;
  readonly size: number;
};

// Options for `getSignedUrl`. `contentDisposition` lets the caller hint the
// browser to download-with-name vs inline-display (maps to ResponseContent-
// Disposition on S3). Keep the option-bag small and additive; provider impls
// that don't support a given hint should ignore it rather than error.
export type SignedUrlOptions = {
  readonly contentDisposition?: string;
};

// Options fuer `writeStream`. `mimeType` ist Content-Type-Hint analog zu
// `write`. `contentLength` ist optional fuer Provider die einen Length-
// Header brauchen (S3 multipart hat einen TransferManager, kann auch ohne
// length); local-Provider ignoriert beides.
export type WriteStreamOptions = {
  readonly mimeType?: string;
  readonly contentLength?: number;
};

// Primitive storage contract: key+bytes in, bytes out. Metadata (fileName,
// mimeType, size) lives on the FileRef row — the provider only needs to
// shuttle bytes. `mimeType` on write() is a hint for providers that need a
// Content-Type header (S3/R2/…); local filesystems can ignore it.
//
// **Streaming-Pfad (`writeStream`)** ist optional und ist die Skalierungs-
// Variante zu `write` fuer Bundles die nicht in Memory passen sollen
// (User-Data-Export ZIPs, Backup-Archives, ...). Source ist eine
// `AsyncIterable<Uint8Array>` — der Caller streamt chunk-fuer-chunk
// rein, der Provider schreibt direkt durch. Niemals alles im Memory.
// Wenn ein Provider `writeStream` nicht implementiert, faellt der
// Caller via Feature-Detect auf chunk-collection + write zurueck oder
// erkennt das Setup-Limit fruehzeitig.
//
// **Streaming-Pfad (`readStream`)** ist die Lese-Variante: gibt eine
// `AsyncIterable<Uint8Array>` zurueck statt der ganzen Datei in Memory.
// Wichtig fuer Atom 3c+ (User-Data-Export ZIP-Bau iteriert ueber alle
// fileRefs und streamt Bytes durch den ZIP-Builder — bei einem User mit
// 50 PDFs à 10MB sonst 500MB Heap-Spike). Wenn ein Provider readStream
// nicht implementiert, faellt der Caller per feature-detect auf read()
// + chunk-collection zurueck oder erkennt das Setup-Limit fruehzeitig.
//
// `getSignedUrl` ist optional: object-store backends (S3/R2/GCS) implement it
// so clients can download directly from the provider after the server has
// checked access — offloads bandwidth and enables browser-native caching.
// Filesystem providers leave it undefined; the route then returns 501 and
// the client falls back to streaming via GET /files/:id. Callers must
// feature-detect via `typeof provider.getSignedUrl === "function"`.
export type FileStorageProvider = {
  write(key: string, data: Uint8Array, mimeType?: string): Promise<void>;
  writeStream?(
    key: string,
    source: AsyncIterable<Uint8Array>,
    options?: WriteStreamOptions,
  ): Promise<void>;
  read(key: string): Promise<Uint8Array>;
  readStream?(key: string): AsyncIterable<Uint8Array>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  getSignedUrl?(key: string, expiresInSeconds: number, options?: SignedUrlOptions): Promise<string>;
};

export type FileValidationOptions = {
  readonly maxSize?: string | undefined;
  readonly accept?: readonly string[] | undefined;
};

export function parseMaxSize(maxSize: string): number {
  const match = maxSize.match(/^(\d+)(kb|mb|gb)$/i);
  if (!match) throw new Error(`Invalid maxSize format: "${maxSize}". Use e.g. "10mb", "500kb".`);
  const value = Number(match[1]);
  const unit = (match[2] ?? "").toLowerCase();
  switch (unit) {
    case "kb":
      return value * 1024;
    case "mb":
      return value * 1024 * 1024;
    case "gb":
      return value * 1024 * 1024 * 1024;
    default:
      throw new Error(`Unknown unit: ${unit}`);
  }
}

// Extension → acceptable MIME-type whitelist. Guards against a client
// uploading e.g. name="x.jpg" with mimeType="application/pdf" to slip an
// executable past the extension-only check. Kept small & conservative — add
// entries on demand rather than importing a heavyweight mime DB.
const EXTENSION_MIME_WHITELIST: Record<string, readonly string[]> = {
  jpg: ["image/jpeg", "image/jpg"],
  jpeg: ["image/jpeg", "image/jpg"],
  png: ["image/png"],
  gif: ["image/gif"],
  webp: ["image/webp"],
  svg: ["image/svg+xml"],
  pdf: ["application/pdf"],
  txt: ["text/plain"],
  csv: ["text/csv", "application/csv", "text/plain"],
  json: ["application/json", "text/json"],
  md: ["text/markdown", "text/plain"],
};

export function validateFile(
  metadata: FileMetadata,
  options: FileValidationOptions,
): string | null {
  if (options.maxSize) {
    const maxBytes = parseMaxSize(options.maxSize);
    if (metadata.size > maxBytes) {
      return `file_too_large: ${metadata.size} bytes exceeds ${options.maxSize}`;
    }
  }

  if (options.accept && options.accept.length > 0) {
    const ext = metadata.fileName.split(".").pop()?.toLowerCase();
    if (!ext || !options.accept.includes(ext)) {
      return `invalid_file_type: ".${ext}" is not in [${options.accept.join(", ")}]`;
    }
    // Extension passed the whitelist — now make sure the client-reported
    // mimeType is consistent with that extension. Guards against MIME-spoofing:
    // an attacker can't claim extension=jpg while actually uploading PDF bytes
    // and having the mimeType reflect that.
    const allowedMimes = EXTENSION_MIME_WHITELIST[ext];
    if (allowedMimes && metadata.mimeType) {
      const normalized = metadata.mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
      if (!allowedMimes.includes(normalized)) {
        return `mime_mismatch: extension ".${ext}" does not match mimeType "${metadata.mimeType}"`;
      }
    }
  }

  return null;
}

export function buildStorageKey(
  tenantId: TenantId,
  entityType: string,
  entityId: number | string,
  fieldName: string,
  fileName: string,
  uniqueId: string,
): string {
  const ext = fileName.split(".").pop() ?? "bin";
  return `${tenantId}/${entityType}/${entityId}/${fieldName}/${uniqueId}.${ext}`;
}
