import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntityExecutor,
  defineWriteHandler,
  type HandlerEvents,
  type SessionUser,
  SYSTEM_ROLE,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { FILE_REF_ENTITY_NAME } from "@cosmicdrift/kumiko-framework/files";
import { DOCUMENT_ENTITY } from "../constants.ts";
import { ensureDocumentLink } from "../ensure-link.ts";
import type { DocumentExecutors } from "../executor.ts";
import { type ImportDocumentPayload, importDocumentPayloadSchema } from "../schemas.ts";

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

type StreamLoader = Pick<HandlerEvents, "load">;

// The stream, not the projected row: a row-level readAccess can hide a document from the system
// user, and a deleted document still has its stream.
async function streamTypeOf(events: StreamLoader, id: string): Promise<string | undefined> {
  const [first] = await events.load(id, { atVersion: 1 });
  return first?.aggregateType;
}

// undefined: the document exists now, created here or by an earlier run of the same import.
async function createUnlessImported(
  executors: DocumentExecutors,
  events: StreamLoader,
  payload: ImportDocumentPayload,
  user: SessionUser,
  db: TenantDb,
): Promise<WriteFailure | undefined> {
  const existingType = await streamTypeOf(events, payload.id);
  if (existingType === undefined) {
    const created = await executors.document.create(
      {
        id: payload.id,
        title: payload.title,
        category: payload.category,
        file: payload.fileRefId,
        ...(payload.issuedAt !== undefined && { issuedAt: payload.issuedAt }),
        ...(payload.validUntil !== undefined && { validUntil: payload.validUntil }),
      },
      user,
      db,
    );
    if (created.isSuccess) return undefined;
    if (created.error.code !== "version_conflict") return created;
  }
  // Stream ids are unique per tenant across aggregate types: an existing stream is the retry of
  // this import only when it is a document, otherwise linking would point at nothing.
  const streamType = existingType ?? (await streamTypeOf(events, payload.id));
  if (streamType === DOCUMENT_ENTITY) return undefined;
  return writeFailure(
    new ConflictError({
      message: `documents import: id ${payload.id} belongs to another record`,
      i18nKey: "documents.errors.import-id-taken",
      details: { id: payload.id },
    }),
  );
}

// For one-off migrations run as a job: the caller picks the document id, so a re-run converges
// on the same document instead of duplicating it. Never callable by a user.
export function createImportDocumentHandler(args: ImportArgs) {
  const { executors, categories, linkTargets } = args;
  return defineWriteHandler({
    name: "import",
    schema: importDocumentPayloadSchema,
    access: { roles: [SYSTEM_ROLE] },
    agent: { expose: false, risk: "high" },
    description:
      "Creates a document with a caller-chosen id from an existing file, links it to the given records and optionally leaves it deleted; a repeat call with the same id changes nothing, and an id already used by another record fails. The document's createdAt is the time of the import; issuedAt carries the business date. Reserved for the system user, meant for data migrations.",
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

      const notImported = await createUnlessImported(
        executors,
        ctx.events,
        payload,
        event.user,
        ctx.db,
      );
      if (notImported !== undefined) return notImported;
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
