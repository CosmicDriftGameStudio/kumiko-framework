import {
  type AccessRule,
  defineQueryHandler,
  type HandlerContext,
  toKebab,
} from "@cosmicdrift/kumiko-framework/engine";
import { DocumentsQueries } from "../constants.ts";
import { type ForRecordPayload, forRecordPayloadSchema } from "../schemas.ts";
import { linkedDocumentIds, listDocuments } from "./list-page.ts";

const EMPTY_PAGE = { rows: [], nextCursor: null, total: 0 };
const LIVE_ENTITIES = ["document", "document-link"];

type Dispatching = Pick<HandlerContext, "dispatch">;

async function documentsOfRecord(
  ctx: Dispatching,
  linkTargets: readonly string[],
  payload: ForRecordPayload,
) {
  const { entityType, entityId, filter, filters, ...paging } = payload;
  if (!linkTargets.includes(entityType)) return EMPTY_PAGE;
  const ids = await linkedDocumentIds(ctx, { entityType, entityId });
  if (ids.length === 0) return EMPTY_PAGE;
  return listDocuments(ctx, {
    ...paging,
    filters: [
      { field: "id", op: "in", value: ids },
      ...(filter !== undefined ? [filter] : []),
      ...(filters ?? []),
    ],
  });
}

export function createForRecordQuery(access: AccessRule, linkTargets: readonly string[]) {
  return defineQueryHandler({
    name: "for-record",
    schema: forRecordPayloadSchema,
    access,
    liveEntities: LIVE_ENTITIES,
    description:
      "Lists the documents linked to one record, paged and filterable like the document list; a record the caller cannot read, or a type that takes no documents, yields an empty page.",
    handler: async (query, ctx) => documentsOfRecord(ctx, linkTargets, query.payload),
  });
}

export function forTypeQueryName(entityType: string): string {
  return `for-${toKebab(entityType)}`;
}

export function forTypeQueryQn(entityType: string): string {
  return `${DocumentsQueries.forRecord.replace(/for-record$/, "")}${forTypeQueryName(entityType)}`;
}

// A relatedList tab sends only the parent id, so the host type is fixed per query.
export function createForTypeQuery(
  access: AccessRule,
  linkTargets: readonly string[],
  entityType: string,
) {
  return defineQueryHandler({
    name: forTypeQueryName(entityType),
    schema: forRecordPayloadSchema.omit({ entityType: true, entityId: true }).extend({
      id: forRecordPayloadSchema.shape.entityId,
    }),
    access,
    liveEntities: LIVE_ENTITIES,
    description: `Lists the documents linked to one ${entityType} record by its id, paged and filterable like the document list; it feeds the documents tab on the ${entityType} screen.`,
    handler: async (query, ctx) => {
      const { id, ...rest } = query.payload;
      return documentsOfRecord(ctx, linkTargets, { ...rest, entityType, entityId: id });
    },
  });
}
