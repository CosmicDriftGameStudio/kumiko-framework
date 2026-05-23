import { selectMany, type WhereObject } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { z } from "zod";

// DSGVO Art. 15 Selbstauskunft — User reads HIS OWN audit-log.
// WHERE createdBy = ctx.user.id ist hard-coded (kein userId-Param,
// anti-cross-user-Snooping). KEIN tenantId-Filter: User hat Anspruch
// auf account-weite Sicht ueber alle Memberships — analog Forget-Pfad.
const MAX_LIMIT = 100;

export const myAuditLogQuery = defineQueryHandler({
  name: "my-audit-log",
  schema: z
    .object({
      before: z.string().regex(/^\d+$/, "cursor must be a positive integer").optional(),
      limit: z.number().int().min(1).max(MAX_LIMIT).default(50),
      aggregateType: z.string().optional(),
      eventType: z.string().optional(),
      from: z.iso.datetime().optional(),
      to: z.iso.datetime().optional(),
    })
    .refine((v) => !v.from || !v.to || v.from <= v.to, {
      message: "`from` must be less than or equal to `to`",
      path: ["from"],
    }),
  access: { openToAll: true },
  handler: async (query, ctx) => {
    const p = query.payload;

    // ctx.db.raw weil events-table tenantId-Spalte hat und TenantDb
    // sonst auto-filtert auf currentTenant. Account-weite Sicht ist
    // hier explizit gewollt; Sicherung erfolgt via createdBy-Filter.
    const where: WhereObject = { createdBy: query.user.id };
    if (p.aggregateType) where["aggregateType"] = p.aggregateType;
    if (p.eventType) where["type"] = p.eventType;
    if (p.from || p.to) {
      const range: { gte?: unknown; lte?: unknown } = {};
      if (p.from) range.gte = Temporal.Instant.from(p.from);
      if (p.to) range.lte = Temporal.Instant.from(p.to);
      where["createdAt"] = range;
    }
    if (p.before) where["id"] = { lt: BigInt(p.before) };

    const rows = await selectMany<{
      id: bigint;
      aggregate_id: string;
      aggregate_type: string;
      version: number;
      type: string;
      payload: Record<string, unknown>;
      created_at: unknown;
    }>(ctx.db.raw, eventsTable, where, {
      orderBy: { col: "id", direction: "desc" },
      limit: p.limit,
    });

    const serialised = rows.map((r) => ({
      id: String(r["id"]),
      aggregateId: r["aggregate_id"],
      aggregateType: r["aggregate_type"],
      version: r["version"],
      type: r["type"],
      payload: r["payload"],
      createdAt: r["created_at"],
    }));
    const last = serialised[serialised.length - 1];
    return {
      rows: serialised,
      nextBefore: serialised.length === p.limit && last ? last["id"] : null,
    };
  },
});
