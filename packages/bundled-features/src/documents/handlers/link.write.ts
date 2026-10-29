import {
  type AccessRule,
  defineWriteHandler,
  parentVisibilityFor,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { documentLinkAggregateId } from "../aggregate-id.ts";
import { DOCUMENT_ENTITY } from "../constants.ts";
import { ensureDocumentLink } from "../ensure-link.ts";
import type { DocumentExecutors } from "../executor.ts";
import { documentLinkPayloadSchema } from "../schemas.ts";
import { canWriteLinkTarget } from "../target-write-check.ts";

type LinkHandlerArgs = {
  readonly access: AccessRule;
  readonly executors: DocumentExecutors;
  readonly linkTargets: readonly string[];
};

// Unreadable document, foreign target type and unwritable target answer alike (not found), so
// the call is no probe for what exists.
export function createLinkDocumentHandler(args: LinkHandlerArgs) {
  const { access, executors, linkTargets } = args;
  return defineWriteHandler({
    name: "link",
    schema: documentLinkPayloadSchema,
    access,
    description:
      "Makes a document visible on another record by linking it to that record; the caller must be able to read the document and edit the record.",
    handler: async (event, ctx): Promise<WriteResult<unknown>> => {
      const payload = event.payload;
      const notFound = () => writeFailure(new NotFoundError(DOCUMENT_ENTITY, payload.documentId));
      if (!linkTargets.includes(payload.entityType)) return notFound();
      const document = await executors.document.detail(
        { id: payload.documentId },
        event.user,
        ctx.db,
        {
          parentVisibility: parentVisibilityFor(ctx, event.user),
        },
      );
      if (document === null) return notFound();
      if (
        !(await canWriteLinkTarget(
          ctx.registry,
          payload.entityType,
          payload.entityId,
          event.user,
          ctx.db,
        ))
      ) {
        return notFound();
      }
      return ensureDocumentLink(executors, event.user, ctx.db, payload.documentId, payload);
    },
  });
}

export function createUnlinkDocumentHandler(args: LinkHandlerArgs) {
  const { access, executors, linkTargets } = args;
  return defineWriteHandler({
    name: "unlink",
    schema: documentLinkPayloadSchema,
    access,
    description:
      "Removes a document from a record it was linked to, reporting success when no link existed; the document and its file stay.",
    handler: async (event, ctx): Promise<WriteResult<unknown>> => {
      const payload = event.payload;
      const notFound = () => writeFailure(new NotFoundError(DOCUMENT_ENTITY, payload.documentId));
      if (!linkTargets.includes(payload.entityType)) return notFound();
      const document = await executors.document.detail(
        { id: payload.documentId },
        event.user,
        ctx.db,
        {
          parentVisibility: parentVisibilityFor(ctx, event.user),
        },
      );
      if (document === null) return notFound();
      if (
        !(await canWriteLinkTarget(
          ctx.registry,
          payload.entityType,
          payload.entityId,
          event.user,
          ctx.db,
        ))
      ) {
        return notFound();
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
