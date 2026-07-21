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
} satisfies Record<string, readonly string[]>;

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
