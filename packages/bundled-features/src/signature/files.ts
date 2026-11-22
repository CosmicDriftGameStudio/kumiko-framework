import {
  createEventStoreExecutor,
  selectMany,
  type TenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import {
  type CreatedFileRef,
  fileRefEntity,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import type { GeneratedFileContext } from "../shared/index.ts";

const SIGNED_URL_SECONDS = 15 * 60;

// Only the opening page of a link gets a URL, and a short-lived one. Providers without presigned
// URLs (filesystem) yield null; the page then shows the document another way or not at all.
export async function signedDocumentUrl(
  ctx: Pick<GeneratedFileContext, "db" | "services">,
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
