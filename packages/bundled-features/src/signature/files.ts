import {
  createEventStoreExecutor,
  selectMany,
  type TenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { fileRefEntity, fileRefsTable } from "@cosmicdrift/kumiko-framework/files";
import type { GeneratedFileContext } from "../file-foundation/index.ts";

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

export { discardGeneratedFile } from "../file-foundation/index.ts";

export async function deleteFileRef(db: TenantDb, user: SessionUser, id: string): Promise<void> {
  await fileRefExecutor.delete({ id }, user, db);
}
