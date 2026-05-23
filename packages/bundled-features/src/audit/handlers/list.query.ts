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

import { selectMany, type WhereObject } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { z } from "zod";

const MAX_LIMIT = 100;

export const listQuery = defineQueryHandler({
  name: "list",
  schema: z
    .object({
      before: z.string().regex(/^\d+$/, "cursor must be a positive integer").optional(),
      limit: z.number().int().min(1).max(MAX_LIMIT).default(50),
      aggregateType: z.string().optional(),
      aggregateId: z.uuid().optional(),
      eventType: z.string().optional(),
      userId: z.string().optional(),
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
    const where: WhereObject = { tenantId: query.user.tenantId };
    if (p.aggregateType) where["aggregateType"] = p.aggregateType;
    if (p.aggregateId) where["aggregateId"] = p.aggregateId;
    if (p.eventType) where["type"] = p.eventType;
    if (p.userId) where["createdBy"] = p.userId;
    if (p.from || p.to) {
      const range: { gte?: unknown; lte?: unknown } = {};
      if (p.from) range.gte = Temporal.Instant.from(p.from);
      if (p.to) range.lte = Temporal.Instant.from(p.to);
      where["createdAt"] = range;
    }
    if (p.before) where["id"] = { lt: BigInt(p.before) };

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
    }>(ctx.db, eventsTable, where, {
      orderBy: { col: "id", direction: "desc" },
      limit: p.limit,
    });

    const serialised = rows.map((r) => ({
      id: String(r.id),
      aggregateId: r.aggregateId,
      aggregateType: r.aggregateType,
      version: r.version,
      type: r.type,
      payload: r.payload,
      metadata: r.metadata,
      createdAt: r.createdAt,
      createdBy: r.createdBy,
    }));
    const last = serialised[serialised.length - 1];
    return {
      rows: serialised,
      nextBefore: serialised.length === p.limit && last ? last.id : null,
    };
  },
});
