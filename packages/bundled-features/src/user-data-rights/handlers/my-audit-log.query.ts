import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { and, desc, eq, gte, lt, lte } from "drizzle-orm";
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

    const conditions = [eq(eventsTable.createdBy, query.user.id)];
    if (p.aggregateType) conditions.push(eq(eventsTable.aggregateType, p.aggregateType));
    if (p.eventType) conditions.push(eq(eventsTable.type, p.eventType));
    if (p.from) conditions.push(gte(eventsTable.createdAt, Temporal.Instant.from(p.from)));
    if (p.to) conditions.push(lte(eventsTable.createdAt, Temporal.Instant.from(p.to)));
    if (p.before) conditions.push(lt(eventsTable.id, BigInt(p.before)));

    // ctx.db.raw weil events-table tenantId-Spalte hat und TenantDb
    // sonst auto-filtert auf currentTenant. Account-weite Sicht ist
    // hier explizit gewollt; Sicherung erfolgt via createdBy-Filter.
    const rows = await ctx.db.raw
      .select({
        id: eventsTable.id,
        aggregateId: eventsTable.aggregateId,
        aggregateType: eventsTable.aggregateType,
        version: eventsTable.version,
        type: eventsTable.type,
        payload: eventsTable.payload,
        createdAt: eventsTable.createdAt,
      })
      .from(eventsTable)
      .where(and(...conditions))
      .orderBy(desc(eventsTable.id))
      .limit(p.limit);

    const serialised = rows.map((r) => ({ ...r, id: String(r["id"]) }));
    const last = serialised[serialised.length - 1];
    return {
      rows: serialised,
      nextBefore: serialised.length === p.limit && last ? last["id"] : null,
    };
  },
});
