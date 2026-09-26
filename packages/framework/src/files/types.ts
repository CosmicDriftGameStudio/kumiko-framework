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

function extractExtension(fileName: string): string | undefined {
  return fileName.split(".").pop()?.toLowerCase();
}

// Extension → acceptable MIME-type whitelist. Backs the cheap metadata
// pre-check in validateFile AND the signature lookup in validateFileContent.
// Kept small & conservative; add entries on demand rather than importing a
// heavyweight mime DB.
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

// Extension → declared MIME → canonical MIME. Windows resolves .csv's upload
// MIME from Explorer's Excel file association, sending "application/vnd.ms-excel" for plain-text CSV.
const EXTENSION_MIME_ALIASES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  csv: { "application/vnd.ms-excel": "text/csv" },
};

// Object.hasOwn at both levels: a plain `in` check on `{}` resolves to
// Object.prototype members ("constructor", …) for any ext/mimeType.
function lookupMimeAlias(ext: string, normalizedMimeType: string): string | undefined {
  if (!Object.hasOwn(EXTENSION_MIME_ALIASES, ext)) return undefined;
  const aliasesForExt = EXTENSION_MIME_ALIASES[ext];
  if (!aliasesForExt || !Object.hasOwn(aliasesForExt, normalizedMimeType)) return undefined;
  return aliasesForExt[normalizedMimeType];
}

// Same hasOwn guard as lookupMimeAlias above, for the ext-keyed whitelist.
function lookupExtensionWhitelist(ext: string): readonly string[] | undefined {
  if (!Object.hasOwn(EXTENSION_MIME_WHITELIST, ext)) return undefined;
  return EXTENSION_MIME_WHITELIST[ext];
}

// Reverse of lookupExtensionWhitelist: every extension whose whitelist entry
// includes this MIME type (e.g. "image/jpeg" -> ["jpg", "jpeg"]) — backs
// validateFileContent's accept-based normalization below.
function extensionsForMimeType(mimeType: string): readonly string[] {
  return Object.entries(EXTENSION_MIME_WHITELIST)
    .filter(([, mimeTypes]) => mimeTypes.includes(mimeType))
    .map(([ext]) => ext);
}

// Magic-byte signatures for the subset of EXTENSION_MIME_WHITELIST that has
// a reliable binary signature. Used both at upload time (validateFileContent)
// and at serve time (resolveServedContentType) — never trust the stored/
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
  // Full 8-byte OLE Compound File signature — legacy .doc/.xls/.ppt share it,
  // so any OLE file sniffs as msword regardless of which one it really is.
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

/**
 * Canonical MIME type for a known binary magic-byte signature (png, jpeg,
 * gif, webp, pdf, OLE, ZIP), or null for everything else — text formats
 * (csv, txt, json, svg, md) have no signature and always return null. Every
 * OLE Compound File (.doc/.xls/.ppt) returns "application/msword" and every
 * ZIP (.docx/.xlsx/.pptx/.zip) returns the docx MIME — callers can't tell
 * those apart by bytes alone.
 */
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
    const ext = extractExtension(metadata.fileName);
    if (!ext || !options.accept.includes(ext)) {
      return `invalid_file_type: ".${ext}" is not in [${options.accept.join(", ")}]`;
    }
    // Cheap metadata pre-check only: the client/runtime mimeType is no
    // evidence of file content (Bun derives it from the filename itself).
    const allowedMimes = lookupExtensionWhitelist(ext);
    if (allowedMimes && metadata.mimeType) {
      const normalized = normalizeMimeType(metadata.mimeType);
      const isAliasedMime = lookupMimeAlias(ext, normalized) !== undefined;
      if (!allowedMimes.includes(normalized) && !isAliasedMime) {
        return `mime_mismatch: extension ".${ext}" does not match mimeType "${metadata.mimeType}"`;
      }
    }
  }

  return null;
}

function signatureMimeTypesForExtension(ext: string): readonly string[] {
  const whitelist = lookupExtensionWhitelist(ext);
  if (!whitelist) return [];
  return whitelist.filter((candidate) =>
    MAGIC_BYTE_SIGNATURES.some((signature) => signature.mimeType === candidate),
  );
}

export type FileContentValidationResult =
  | { readonly kind: "ok" }
  | { readonly kind: "normalized"; readonly extension: string; readonly mimeType: string }
  | { readonly kind: "rejected"; readonly error: string };

// Separate from validateFile: metadata is known before the upload body is
// fully read, content-verification only after — callers reject early on
// metadata without buffering bytes they'll then have to reject anyway.
//
// When the sniffed signature doesn't match the declared extension but the
// sniffed type's OWN extension is in a non-empty `accept`, the upload
// normalizes to that type instead of being rejected — this only widens which
// of the field's own allowed formats a mislabeled upload can settle into,
// never which formats are accepted. With no `accept` restriction at all
// (undefined or empty, same "unrestricted" meaning validateFile gives it),
// any recognized signature normalizes the same way, since there is no
// declared list left to widen.
export function validateFileContent(
  fileName: string,
  content: Uint8Array,
  accept?: readonly string[],
): FileContentValidationResult {
  const ext = extractExtension(fileName);
  if (!ext) return { kind: "ok" };
  const signatureMimeTypes = signatureMimeTypesForExtension(ext);
  if (signatureMimeTypes.length === 0) return { kind: "ok" };
  const sniffed = sniffMimeType(content);
  if (sniffed && signatureMimeTypes.includes(sniffed)) return { kind: "ok" };
  if (sniffed) {
    const candidateExtensions = extensionsForMimeType(sniffed);
    const hasAcceptRestriction = accept !== undefined && accept.length > 0;
    const normalizedExtension = hasAcceptRestriction
      ? candidateExtensions.find((candidate) => accept.includes(candidate))
      : candidateExtensions[0];
    if (normalizedExtension) {
      return { kind: "normalized", extension: normalizedExtension, mimeType: sniffed };
    }
  }
  return {
    kind: "rejected",
    error: `content_mismatch: ".${ext}" upload bytes are ${sniffed ?? "unrecognized"}, expected ${signatureMimeTypes.join(" or ")}`,
  };
}

export type UploadMimeTypeResolution =
  | { readonly kind: "ok"; readonly mimeType: string }
  | { readonly kind: "rejected"; readonly error: string };

/**
 * Rewrites an aliased declared mimeType to its canonical form and, in the
 * same call, sniffs the bytes — a renamed binary (a real .xls/.xlsx saved
 * as .csv) must fail here rather than through an optional, skippable step.
 */
export function resolveUploadMimeType(
  fileName: string,
  declaredMimeType: string,
  content: Uint8Array,
): UploadMimeTypeResolution {
  const ext = extractExtension(fileName);
  const normalizedDeclared = normalizeMimeType(declaredMimeType);
  const canonical = ext ? lookupMimeAlias(ext, normalizedDeclared) : undefined;
  if (!canonical) return { kind: "ok", mimeType: declaredMimeType };
  if (sniffMimeType(content) !== null) {
    return {
      kind: "rejected",
      error: `content_mismatch: bytes of ".${ext}" upload declared as "${declaredMimeType}" are a binary format`,
    };
  }
  return { kind: "ok", mimeType: canonical };
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
  // Set when validateFileContent normalized the upload to a different real
  // type — the storage key then reflects the sniffed type, not the user's
  // (wrong) original extension.
  extensionOverride?: string,
): string {
  const rawExt = extensionOverride ?? fileName.split(".").pop() ?? "";
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
