import type { DbRunner, TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { isUuid, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTenantFileContext,
  type FileContext,
  type FileProviderResolver,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";

export type FileRefContent = {
  readonly content: Uint8Array;
  readonly contentType: string;
  readonly tenantId: string;
  readonly size: number;
  /** As stored: personal data that may be PII ciphertext. Decrypt before showing or sending it. */
  readonly fileName: string;
};

type FileRefRow = {
  readonly fileName: string;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly tenantId: string;
  readonly size: number | bigint | string;
};

// Tenant-bound on purpose: without a resolver `ctx.services.files` only reaches the storage of the
// context's own tenant (`contextTenantId`), so a request for another tenant's files is
// undefined instead of silently reading through the wrong tenant's storage.
export function fileContextForTenant(
  ctx: {
    readonly services: {
      readonly _fileProviderResolver?: FileProviderResolver | undefined;
      readonly files?: FileContext | undefined;
    };
  },
  contextTenantId: string,
  tenantId: string,
): FileContext | undefined {
  const resolver = ctx.services._fileProviderResolver;
  if (resolver === undefined) return tenantId === contextTenantId ? ctx.services.files : undefined;
  return fileContextFromResolver(resolver, tenantId);
}

export function fileContextFromResolver(
  resolver: FileProviderResolver,
  tenantId: string,
): FileContext {
  // @cast-boundary engine-payload — tenantId comes from a trusted job payload or session
  const brandedTenantId = tenantId as TenantId;
  return createTenantFileContext(resolver, brandedTenantId);
}

export class FileRefTooLargeError extends Error {
  constructor(readonly size: number) {
    super(`file ref exceeds the size limit (${size} bytes)`);
  }
}

export class FileStorageUnavailableError extends Error {
  constructor() {
    super("readFileRefContent: no file storage is available for the file's tenant");
  }
}

export async function readFileRefContent(args: {
  readonly db: DbRunner | TenantDb;
  readonly filesForTenant: (tenantId: string) => FileContext | undefined;
  readonly fileRefId: string;
  readonly allowedTenantIds: readonly string[];
  /** Only accept this user's own upload that is not bound to any entity yet. */
  readonly unclaimedUploadOf?: string;
  /** Rejects before any bytes are read when the stored size exceeds the limit. */
  readonly maxBytes?: number;
}): Promise<FileRefContent | null> {
  if (!isUuid(args.fileRefId)) return null;
  const [row] = await selectMany<FileRefRow>(args.db, fileRefsTable, {
    id: args.fileRefId,
    tenantId: { in: args.allowedTenantIds },
    isDeleted: false,
    ...(args.unclaimedUploadOf !== undefined && {
      insertedById: args.unclaimedUploadOf,
      entityType: null,
      entityId: null,
    }),
  });
  if (row === undefined) return null;
  const size = Number(row.size);
  if (args.maxBytes !== undefined && size > args.maxBytes) {
    throw new FileRefTooLargeError(size);
  }
  const files = args.filesForTenant(row.tenantId);
  if (files === undefined) {
    throw new FileStorageUnavailableError();
  }
  const content = await files.refFromFileRef(row).read();
  return {
    content,
    contentType: row.mimeType,
    tenantId: row.tenantId,
    size,
    fileName: row.fileName,
  };
}
