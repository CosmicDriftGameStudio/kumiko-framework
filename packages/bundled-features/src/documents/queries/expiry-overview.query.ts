import { type AccessRule, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { expiryWindow } from "../expiry.ts";
import { expiryOverviewPayloadSchema } from "../schemas.ts";
import { linkedDocumentIds, listDocuments } from "./list-page.ts";

type Filter = { readonly field: string; readonly op: string; readonly value: unknown };

// Counts come from the document list itself (totalCount), so they follow the same read gate
// as the rows a user can open.
export function createExpiryOverviewQuery(access: AccessRule, expiringWithinDays: number) {
  return defineQueryHandler({
    name: "expiry-overview",
    schema: expiryOverviewPayloadSchema,
    access,
    liveEntities: ["filed-document", "filed-document-link"],
    description:
      "Counts the documents the caller can read by validity: expired, expiring within the configured window, valid beyond it and without an expiry date; optionally for one record only.",
    handler: async (query, ctx) => {
      const payload = query.payload;
      const { today, horizon } = expiryWindow(ctx, expiringWithinDays);
      const scope: Filter[] = [];
      if (payload.entityType !== undefined && payload.entityId !== undefined) {
        const ids = await linkedDocumentIds(ctx, {
          entityType: payload.entityType,
          entityId: payload.entityId,
        });
        if (ids.length === 0) return { expired: 0, expiring: 0, valid: 0, none: 0 };
        scope.push({ field: "id", op: "in", value: ids });
      }
      const count = async (extra: Filter[]) =>
        (await listDocuments(ctx, { limit: 1, totalCount: true, filters: [...scope, ...extra] }))
          .total ?? 0;

      const [all, expired, expiring, valid] = await Promise.all([
        count([]),
        count([{ field: "validUntil", op: "lt", value: today }]),
        count([
          { field: "validUntil", op: "gte", value: today },
          { field: "validUntil", op: "lte", value: horizon },
        ]),
        count([{ field: "validUntil", op: "gt", value: horizon }]),
      ]);
      return { expired, expiring, valid, none: all - expired - expiring - valid };
    },
  });
}
