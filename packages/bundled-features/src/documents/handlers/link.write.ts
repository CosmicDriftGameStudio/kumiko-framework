import {
  type AccessRule,
  defineWriteHandler,
  type HandlerContext,
  parentVisibilityFor,
  type SessionUser,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { documentLinkAggregateId } from "../aggregate-id.ts";
import { DOCUMENT_ENTITY } from "../constants.ts";
import { ensureDocumentLink } from "../ensure-link.ts";
import type { DocumentExecutors } from "../executor.ts";
import { type DocumentLinkPayload, documentLinkPayloadSchema } from "../schemas.ts";
import { canWriteLinkTarget } from "../target-write-check.ts";

type LinkHandlerArgs = {
  readonly access: AccessRule;
  readonly executors: DocumentExecutors;
  readonly linkTargets: readonly string[];
};

// Unreadable document, foreign target type and unwritable target answer alike (not found), so
// the call is no probe for what exists.
async function mayChangeDocumentLink(
  args: LinkHandlerArgs,
  payload: DocumentLinkPayload,
  user: SessionUser,
  ctx: HandlerContext,
): Promise<boolean> {
  if (!args.linkTargets.includes(payload.entityType)) return false;
  const document = await args.executors.document.detail({ id: payload.documentId }, user, ctx.db, {
    parentVisibility: parentVisibilityFor(ctx, user),
  });
  if (document === null) return false;
  return canWriteLinkTarget(ctx.registry, payload.entityType, payload.entityId, user, ctx.db);
}

export function createLinkDocumentHandler(args: LinkHandlerArgs) {
  const { access, executors } = args;
  return defineWriteHandler({
    name: "link",
    schema: documentLinkPayloadSchema,
    access,
    agent: { risk: "mid" },
    description:
      "Makes a document visible on another record by linking it to that record; the caller must be able to read the document and edit the record.",
    handler: async (event, ctx): Promise<WriteResult<unknown>> => {
      const payload = event.payload;
      if (!(await mayChangeDocumentLink(args, payload, event.user, ctx))) {
        return writeFailure(new NotFoundError(DOCUMENT_ENTITY, payload.documentId));
      }
      return ensureDocumentLink(executors, event.user, ctx.db, payload.documentId, payload);
    },
  });
}

export function createUnlinkDocumentHandler(args: LinkHandlerArgs) {
  const { access, executors } = args;
  return defineWriteHandler({
    name: "unlink",
    schema: documentLinkPayloadSchema,
    access,
    agent: { risk: "mid" },
    description:
      "Removes a document from a record it was linked to, reporting success when no link existed; the document and its file stay.",
    handler: async (event, ctx): Promise<WriteResult<unknown>> => {
      const payload = event.payload;
      if (!(await mayChangeDocumentLink(args, payload, event.user, ctx))) {
        return writeFailure(new NotFoundError(DOCUMENT_ENTITY, payload.documentId));
      }
      const id = documentLinkAggregateId(
        event.user.tenantId,
        payload.documentId,
        payload.entityType,
        payload.entityId,
      );
      const existing = await executors.link.detail({ id }, event.user, ctx.db);
      if (existing === null) return { isSuccess: true as const, data: { id } };
      return executors.link.delete({ id }, event.user, ctx.db);
    },
  });
}
