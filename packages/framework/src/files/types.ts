export type FileMetadata = {
  readonly fileName: string;
  readonly mimeType: string;
  readonly size: number;
};

export type FileStorageProvider = {
  upload(key: string, data: Uint8Array, metadata: FileMetadata): Promise<void>;
  download(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
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
  }

  return null;
}

export function buildStorageKey(
  tenantId: number,
  entityType: string,
  entityId: number,
  fieldName: string,
  fileName: string,
  uniqueId: string,
): string {
  const ext = fileName.split(".").pop() ?? "bin";
  return `${tenantId}/${entityType}/${entityId}/${fieldName}/${uniqueId}.${ext}`;
}
