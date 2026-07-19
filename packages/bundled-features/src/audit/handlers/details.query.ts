// Single audit event by its event-store id — backs the audit-log-detail
// screen. Tenant-isolated at the WHERE level like list.query, so a caller
// can only read events in their own tenant.

import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { z } from "zod";

export const detailsQuery = defineQueryHandler({
  name: "details",
  schema: z.object({
    id: z.string().regex(/^[1-9]\d*$/, "id must be a positive integer"),
  }),
  access: { roles: access.admin },
  handler: async (query, ctx) => {
    const rows = await selectMany<{
      id: bigint;
      aggregateId: string;
      aggregateType: string;
      version: number;
      type: string;
      payload: Record<string, unknown>;
      metadata: Record<string, unknown>;
      createdAt: unknown;
      createdBy: string;
    }>(
      ctx.db,
      eventsTable,
      { tenantId: query.user.tenantId, id: BigInt(query.payload.id) },
      { limit: 1 },
    );
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: String(row.id),
      aggregateId: row.aggregateId,
      aggregateType: row.aggregateType,
      version: row.version,
      type: row.type,
      payload: row.payload,
      metadata: row.metadata,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
    };
  },
});
