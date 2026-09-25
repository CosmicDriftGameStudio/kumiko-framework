import type { TenantId } from "../engine/types/identifiers";

export type FileMetadata = {
  readonly fileName: string;
  readonly mimeType: string;
  readonly size: number;
};

export type {
  FileStorageProvider,
  SignedUrlOptions,
  WriteStreamOptions,
} from "@cosmicdrift/kumiko-types/file-storage-provider-types";

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
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
} satisfies Record<string, readonly string[]>;

// Magic-byte signatures for the subset of EXTENSION_MIME_WHITELIST that has
// a reliable binary signature. Used at SERVE time — never trust the stored/
// client-declared mimeType for Content-Type on its own, sniff the actual
// bytes instead. Types without a stable signature (svg, txt, csv, json, md)
// and anything that matches none of these fall back to
// application/octet-stream in resolveServedContentType below — this also
// guarantees text/html and image/svg+xml are never served inline, even for
// an honestly-declared upload.
const MAGIC_BYTE_SIGNATURES: ReadonlyArray<{
  readonly mimeType: string;
  readonly matches: (bytes: Uint8Array) => boolean;
}> = [
  {
    mimeType: "image/png",
    matches: (bytes) => startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  { mimeType: "image/jpeg", matches: (bytes) => startsWithBytes(bytes, [0xff, 0xd8, 0xff]) },
  {
    mimeType: "image/gif",
    matches: (bytes) => startsWithAscii(bytes, "GIF87a") || startsWithAscii(bytes, "GIF89a"),
  },
  {
    mimeType: "image/webp",
    matches: (bytes) => startsWithAscii(bytes, "RIFF") && startsWithAscii(bytes, "WEBP", 8),
  },
  { mimeType: "application/pdf", matches: (bytes) => startsWithAscii(bytes, "%PDF-") },
  // Full 8-byte OLE Compound File signature (legacy .doc/.xls/.ppt share it —
  // sniffing can't tell them apart by bytes alone, only content-verification
  // below narrows to msword specifically).
  {
    mimeType: "application/msword",
    matches: (bytes) => startsWithBytes(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  },
  // ZIP local-file-header signature — .docx/.xlsx/.pptx/plain .zip all share
  // it; same caveat as OLE above.
  {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    matches: (bytes) => startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]),
  },
];

function startsWithBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, i) => bytes[i] === byte);
}

function startsWithAscii(bytes: Uint8Array, ascii: string, offset = 0): boolean {
  if (bytes.length < offset + ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[offset + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

export function sniffMimeType(bytes: Uint8Array): string | null {
  for (const signature of MAGIC_BYTE_SIGNATURES) {
    if (signature.matches(bytes)) return signature.mimeType;
  }
  return null;
}

// Strips a `; charset=…`-style suffix and trims/lowercases — the one
// normalization every mimeType comparison needs before comparing values.
export function normalizeMimeType(mimeType: string): string {
  return mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
}

// image/jpg is not a registered IANA type but EXTENSION_MIME_WHITELIST above
// accepts it as a jpg alias — sniffMimeType only ever returns the canonical
// image/jpeg, so without this a legitimately-declared "image/jpg" upload
// would mismatch its own sniffed type and get needlessly downgraded.
const DECLARED_MIME_ALIASES: Readonly<Record<string, string>> = {
  "image/jpg": "image/jpeg",
};

// The Content-Type a served file's bytes are safe to go out with. Bytes that
// don't sniff as one of the known-safe binary signatures (including
// svg/html/text formats, which have no reliable magic bytes) always
// downgrade to application/octet-stream. Bytes that DO sniff safely still
// downgrade unless the sniffed type matches what was declared at upload —
// a mismatch (e.g. real PNG bytes uploaded as "text/html") is itself a
// spoofing signal and is never trusted enough to pick a Content-Type from,
// even one that would otherwise be harmless.
export function resolveServedContentType(bytes: Uint8Array, declaredMimeType: string): string {
  const sniffed = sniffMimeType(bytes);
  if (!sniffed) return "application/octet-stream";
  const normalizedDeclared = normalizeMimeType(declaredMimeType);
  const declared = DECLARED_MIME_ALIASES[normalizedDeclared] ?? normalizedDeclared;
  return sniffed === declared ? sniffed : "application/octet-stream";
}

// Signature-checked against the declared mimeType regardless of
// `options.accept`. Deliberately narrow: most of the whitelist has no magic
// bytes at all and would reject honestly-mislabeled uploads if checked.
const CONTENT_VERIFIED_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

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
      const normalized = normalizeMimeType(metadata.mimeType);
      if (!allowedMimes.includes(normalized)) {
        return `mime_mismatch: extension ".${ext}" does not match mimeType "${metadata.mimeType}"`;
      }
    }
  }

  return null;
}

// Separate from validateFile: metadata is known before the upload body is
// fully read, content-verification only after — callers reject early on
// metadata without buffering bytes they'll then have to reject anyway.
export function validateFileContent(mimeType: string, content: Uint8Array): string | null {
  const normalizedDeclared = normalizeMimeType(mimeType);
  if (!CONTENT_VERIFIED_MIME_TYPES.has(normalizedDeclared)) return null;
  const signature = MAGIC_BYTE_SIGNATURES.find((s) => s.mimeType === normalizedDeclared);
  if (signature && !signature.matches(content)) {
    return `content_mismatch: bytes do not match declared mimeType "${mimeType}"`;
  }
  return null;
}

export function assertSafeStorageKey(key: string): void {
  if (key.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error(`storage key contains a path-traversal segment: "${key}"`);
  }
}

export function buildStorageKey(
  tenantId: TenantId,
  entityType: string,
  entityId: number | string,
  fieldName: string,
  fileName: string,
  uniqueId: string,
): string {
  const rawExt = fileName.split(".").pop() ?? "";
  const ext = /^[A-Za-z0-9]+$/.test(rawExt) ? rawExt.toLowerCase() : "bin";
  return `${tenantId}/${entityType}/${entityId}/${fieldName}/${uniqueId}.${ext}`;
}

/** Fixed leading segment so one S3 lifecycle rule (Prefix: "exports/") can expire export bundles for every tenant without matching a buildStorageKey() upload. */
export function tenantExportPrefix(tenantId: TenantId): string {
  return `exports/${tenantId}/`;
}

/**
 * Every storage-key prefix a tenant's binaries can live under. A tenant-destroy
 * prefix sweep must list ALL of these, not just buildStorageKey()'s
 * `${tenantId}/` — new key layouts (like tenantExportPrefix) that don't put
 * the tenant first need adding here too, or a sweep silently stops covering them.
 */
export function tenantStoragePrefixes(tenantId: TenantId): readonly string[] {
  return [`${tenantId}/`, tenantExportPrefix(tenantId)];
}
