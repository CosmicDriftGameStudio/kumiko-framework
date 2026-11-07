import { createHash } from "node:crypto";
import {
  createEventStoreExecutor,
  selectMany,
  type TenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import type { HandlerContext, Registry, SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  type CreatedFileRef,
  createFileRefFromBytes,
  fileRefEntity,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import type { WriteResult } from "@cosmicdrift/kumiko-types/handlers";
import {
  type FileRefContent,
  FileRefTooLargeError,
  fileContextForTenant,
  readFileRefContent,
} from "../file-foundation/index.ts";

export const PDF_MIME_TYPE = "application/pdf";
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const SIGNED_URL_SECONDS = 15 * 60;

type FileContext = Pick<GeneratedFileContext, "db" | "services">;

export type GeneratedFileContext = {
  readonly db: TenantDb;
  readonly services: HandlerContext["services"];
  readonly registry: Registry;
};

// The tenant's file refs only: a caller cannot point a request at another tenant's file.
export async function readTenantFile(
  ctx: FileContext,
  tenantId: string,
  fileRefId: string,
): Promise<FileRefContent | null> {
  try {
    return await readFileRefContent({
      db: ctx.db,
      filesForTenant: (ownerTenantId) => fileContextForTenant(ctx, tenantId, ownerTenantId),
      fileRefId,
      allowedTenantIds: [tenantId],
      maxBytes: MAX_DOCUMENT_BYTES,
    });
  } catch (error) {
    if (error instanceof FileRefTooLargeError) return null;
    throw error;
  }
}

export function storeGeneratedFile(
  ctx: GeneratedFileContext,
  user: SessionUser,
  file: { readonly fileName: string; readonly mimeType: string; readonly data: Uint8Array },
): Promise<WriteResult<CreatedFileRef>> {
  return createFileRefFromBytes({ ...ctx, user }, file);
}

// Only the opening page of a link gets a URL, and a short-lived one. Providers without presigned
// URLs (filesystem) yield null; the page then shows the document another way or not at all.
export async function signedDocumentUrl(
  ctx: FileContext,
  user: SessionUser,
  fileRefId: string,
): Promise<string | null> {
  const resolver = ctx.services._fileProviderResolver;
  if (resolver === undefined) return null;
  const [row] = await selectMany<{ storageKey: string }>(ctx.db, fileRefsTable, {
    id: fileRefId,
    tenantId: user.tenantId,
    isDeleted: false,
  });
  if (row === undefined) return null;
  const provider = await resolver(user.tenantId);
  if (provider.getSignedUrl === undefined) return null;
  return provider.getSignedUrl(row.storageKey, SIGNED_URL_SECONDS, {
    contentDisposition: 'inline; filename="document.pdf"',
  });
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const fileRefExecutor = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
  entityName: "fileRef",
});

// For a stored file whose owner row was never written (a lost sign race): removes ref and bytes so
// no signature image of a person who did not sign stays behind. The ledger entry is not touched:
// this runs inside the transaction that already took it, and a second connection deleting that
// row would wait on the lock this transaction holds.
export async function discardGeneratedFile(
  ctx: GeneratedFileContext,
  user: SessionUser,
  file: CreatedFileRef,
): Promise<void> {
  await deleteFileRef(ctx.db, user, file.id);
  await ctx.services.files?.ref(file.storageKey).delete();
}

export async function deleteFileRef(db: TenantDb, user: SessionUser, id: string): Promise<void> {
  await fileRefExecutor.delete({ id }, user, db);
}
