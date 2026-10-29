import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntityExecutor,
  defineWriteHandler,
  type SessionUser,
  SYSTEM_ROLE,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, ValidationError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { FILE_REF_ENTITY_NAME } from "@cosmicdrift/kumiko-framework/files";
import { DOCUMENT_ENTITY } from "../constants.ts";
import { ensureDocumentLink } from "../ensure-link.ts";
import type { DocumentExecutors } from "../executor.ts";
import { importDocumentPayloadSchema } from "../schemas.ts";

type ImportArgs = {
  readonly executors: DocumentExecutors;
  readonly categories: readonly string[];
  readonly linkTargets: readonly string[];
};

async function fileRefExists(
  registry: Parameters<WriteHandlerDef["handler"]>[1]["registry"],
  fileRefId: string,
  user: SessionUser,
  db: TenantDb,
): Promise<boolean> {
  const entity = registry.getEntity(FILE_REF_ENTITY_NAME);
  if (entity === undefined) return false;
  const row = await createEntityExecutor(FILE_REF_ENTITY_NAME, entity).executor.detail(
    { id: fileRefId },
    user,
    db,
  );
  return row !== null;
}

// For one-off migrations run as a job: the caller picks the document id, so a re-run converges
// on the same document instead of duplicating it. Never callable by a user.
export function createImportDocumentHandler(args: ImportArgs) {
  const { executors, categories, linkTargets } = args;
  return defineWriteHandler({
    name: "import",
    schema: importDocumentPayloadSchema,
    access: { roles: [SYSTEM_ROLE] },
    agent: { expose: false },
    description:
      "Creates a document with a caller-chosen id from an existing file, links it to the given records and optionally leaves it deleted; a repeat call with the same id changes nothing. Reserved for the system user, meant for data migrations.",
    handler: async (event, ctx) => {
      const payload = event.payload;
      if (!categories.includes(payload.category)) {
        return writeFailure(
          new ValidationError({
            fields: [
              {
                path: "category",
                code: "unknown_category",
                i18nKey: "documents.errors.unknown-category",
                params: { category: payload.category },
              },
            ],
          }),
        );
      }
      const badTarget = payload.links.find((link) => !linkTargets.includes(link.entityType));
      if (badTarget !== undefined) {
        return writeFailure(
          new ValidationError({
            fields: [
              {
                path: "links",
                code: "unknown_link_target",
                i18nKey: "documents.errors.unknown-link-target",
                params: { entityType: badTarget.entityType },
              },
            ],
          }),
        );
      }
      if (!(await fileRefExists(ctx.registry, payload.fileRefId, event.user, ctx.db))) {
        return writeFailure(new NotFoundError(FILE_REF_ENTITY_NAME, payload.fileRefId));
      }

      const existing = await executors.document.detail({ id: payload.id }, event.user, ctx.db);
      if (existing === null) {
        const created = await executors.document.create(
          {
            id: payload.id,
            title: payload.title,
            category: payload.category,
            file: payload.fileRefId,
            ...(payload.issuedAt !== undefined && { issuedAt: payload.issuedAt }),
            ...(payload.validUntil !== undefined && { validUntil: payload.validUntil }),
          },
          event.user,
          ctx.db,
        );
        if (!created.isSuccess && created.error.code !== "version_conflict") return created;
      }
      for (const link of payload.links) {
        const linked = await ensureDocumentLink(executors, event.user, ctx.db, payload.id, link);
        if (!linked.isSuccess) return linked;
      }
      if (payload.deleted === true) {
        const removed = await executors.document.delete({ id: payload.id }, event.user, ctx.db);
        if (!removed.isSuccess && removed.error.code !== "not_found") return removed;
      }
      return { isSuccess: true as const, data: { id: payload.id, entity: DOCUMENT_ENTITY } };
    },
  });
}
