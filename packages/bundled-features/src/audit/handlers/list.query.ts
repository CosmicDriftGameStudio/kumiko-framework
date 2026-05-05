// Audit query — reads the event-store's `events` table directly. The event-
// log IS the audit trail by construction: every entity write appends at least
// one event with createdBy (who), createdAt (when), tenantId (where),
// aggregateType + aggregateId (what), type (action), and payload (delta).
//
// No projection, no separate audit table. Queryable with the same filter
// surface any audit UI needs; tenant-isolated at the WHERE level so cross-
// tenant peeking is structurally impossible for non-SystemAdmin callers.
//
// Sensitive field-values are already stripped out of payloads at event-
// append time (see event-store-executor → stripSensitive), so this query
// can't surface PII that the entity definition marked as sensitive.

import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { and, desc, eq, gte, lt, lte } from "drizzle-orm";
import { z } from "zod";

// Per-page cap. 100 keeps a single page payload bounded while being enough
// for a humans-browse UI — clients that need exports iterate by `before`.
const MAX_LIMIT = 100;

export const listQuery = defineQueryHandler({
  name: "list",
  schema: z
    .object({
      // Cursor-style pagination: pass the `id` from the last row of the
      // previous page as `before`. bigserial ids are monotonic, so `< before`
      // reliably returns "the next older page". Beats OFFSET on large tables.
      // The regex pins the input to digits-only — otherwise an invalid value
      // would surface as a raw PG `invalid_text_representation` instead of a
      // clean 400 at the schema gate.
      before: z.string().regex(/^\d+$/, "cursor must be a positive integer").optional(),
      limit: z.number().int().min(1).max(MAX_LIMIT).default(50),
      // Filters — all optional. Combined via AND.
      aggregateType: z.string().optional(),
      aggregateId: z.uuid().optional(),
      eventType: z.string().optional(),
      // createdBy is stored as text on the events table (it accepts both UUIDs
      // and system actor strings like "SYSTEM"), so the filter is a plain
      // equality check on the raw value.
      userId: z.string().optional(),
      // Inclusive bounds. Clients pass ISO-8601; we parse to Temporal.Instant
      // and compare via the `instant()` column type.
      from: z.iso.datetime().optional(),
      to: z.iso.datetime().optional(),
    })
    .refine((v) => !v.from || !v.to || v.from <= v.to, {
      message: "`from` must be less than or equal to `to`",
      path: ["from"],
    }),
  access: { roles: ["Admin", "SystemAdmin"] },
  handler: async (query, ctx) => {
    const p = query.payload;
    const tenantId = query.user.tenantId;

    const conditions = [eq(eventsTable.tenantId, tenantId)];
    if (p.aggregateType) conditions.push(eq(eventsTable.aggregateType, p.aggregateType));
    if (p.aggregateId) conditions.push(eq(eventsTable.aggregateId, p.aggregateId));
    if (p.eventType) conditions.push(eq(eventsTable.type, p.eventType));
    if (p.userId) conditions.push(eq(eventsTable.createdBy, p.userId));
    if (p.from) conditions.push(gte(eventsTable.createdAt, Temporal.Instant.from(p.from)));
    if (p.to) conditions.push(lte(eventsTable.createdAt, Temporal.Instant.from(p.to)));
    // `before` = last seen id from the previous page. bigserial so `<` walks
    // backwards in chronological order. Schema-regex guarantees the string
    // is digits-only, so BigInt(...) can't throw.
    if (p.before) conditions.push(lt(eventsTable.id, BigInt(p.before)));

    const rows = await ctx.db
      .select({
        id: eventsTable.id,
        aggregateId: eventsTable.aggregateId,
        aggregateType: eventsTable.aggregateType,
        version: eventsTable.version,
        type: eventsTable.type,
        payload: eventsTable.payload,
        metadata: eventsTable.metadata,
        createdAt: eventsTable.createdAt,
        createdBy: eventsTable.createdBy,
      })
      .from(eventsTable)
      .where(and(...conditions))
      .orderBy(desc(eventsTable.id))
      .limit(p.limit);

    // bigint ids need serialisation — JSON can't carry a plain BigInt, and
    // clients pass the cursor back as a string via `before`. Stringified once
    // here so the response shape matches what the caller will re-submit.
    const serialised = rows.map((r) => ({ ...r, id: String(r["id"]) }));
    const last = serialised[serialised.length - 1];
    return {
      rows: serialised,
      // Cursor for the NEXT page. Null when this page is partial (we hit
      // the start of the log) so clients know to stop.
      nextBefore: serialised.length === p.limit && last ? last["id"] : null,
    };
  },
});
