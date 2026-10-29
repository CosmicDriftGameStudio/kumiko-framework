import { type AccessRule, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { EXPIRING_FACET_VALUE } from "../constants.ts";
import { expiryStateOf, expiryWindow } from "../expiry.ts";
import { overviewPayloadSchema } from "../schemas.ts";
import { type ListFilter, listDocuments } from "./list-page.ts";

const EXPIRY_FILTER_FIELD = "expiry";

// The "expiring" facet is a moving date window, which a facet on a stored field cannot
// express; it becomes a validUntil bound here, expired documents included. A document
// without a date never matches it.
function toDocumentFilters(filters: readonly ListFilter[], horizon: string): readonly ListFilter[] {
  return filters.flatMap((clause): ListFilter[] => {
    if (clause.field !== EXPIRY_FILTER_FIELD) return [clause];
    const wantsExpiring =
      Array.isArray(clause.value) && clause.value.includes(EXPIRING_FACET_VALUE);
    return wantsExpiring ? [{ field: "validUntil", op: "lte", value: horizon }] : [];
  });
}

export function createOverviewQuery(access: AccessRule, expiringWithinDays: number) {
  return defineQueryHandler({
    name: "overview",
    schema: overviewPayloadSchema,
    access,
    liveEntities: ["filed-document", "filed-document-link"],
    description:
      "Lists the documents the caller can read with an expiry state per row (expired, expiring, valid, none); the expiring filter returns expired and soon-expiring documents. Powers the documents list screen.",
    handler: async (query, ctx) => {
      const { filters, ...paging } = query.payload;
      const window = expiryWindow(ctx, expiringWithinDays);
      const page = await listDocuments(ctx, {
        ...paging,
        filters: toDocumentFilters(filters ?? [], window.horizon),
      });
      return {
        ...page,
        rows: page.rows.map((row) => ({
          ...row,
          expiry: expiryStateOf(row["validUntil"], window),
        })),
      };
    },
  });
}
