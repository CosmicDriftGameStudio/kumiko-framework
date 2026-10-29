import { type AccessRule, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
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
    liveEntities: ["document", "document-link"],
    description:
      "Counts the documents the caller can read by validity: expired, expiring within the configured window, valid beyond it and without an expiry date; optionally for one record only.",
    handler: async (query, ctx) => {
      const payload = query.payload;
      const today = ctx.tz.today(ctx.tz.tenant);
      const horizon = today.add({ days: expiringWithinDays });
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
        count([{ field: "validUntil", op: "lt", value: today.toString() }]),
        count([
          { field: "validUntil", op: "gte", value: today.toString() },
          { field: "validUntil", op: "lte", value: horizon.toString() },
        ]),
        count([{ field: "validUntil", op: "gt", value: horizon.toString() }]),
      ]);
      return { expired, expiring, valid, none: all - expired - expiring - valid };
    },
  });
}
