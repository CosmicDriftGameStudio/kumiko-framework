// Audit query — reads the event-store's `events` table directly. The event-
// log IS the audit trail by construction: every entity write appends at least
// one event with createdBy (who), createdAt (when), tenantId (where),
// aggregateType + aggregateId (what), type (action), and payload (delta).
//
// No projection, no separate audit table. Queryable with the same filter
// surface any audit UI needs; tenant-isolated at the WHERE level so cross-
// tenant peeking is structurally impossible for non-SystemAdmin callers.
// A SystemAdmin can pass scope "system" to read the app-instance system events
// (e.g. app.started); no other cross-tenant read exists.
//
// Sensitive field-values are ciphertext inside the event payload (the log
// carries them encrypted); stripSensitive only strips the event echo. This
// query returns payloads as stored, so a sensitive value surfaces as ciphertext,
// never as plaintext.

import { selectMany, type WhereObject } from "@cosmicdrift/kumiko-framework/bun-db";
import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { Temporal } from "temporal-polyfill";
import * as z from "zod";
import { AUDIT_SCOPE_VALUES } from "../constants.js";
import { resolveAuditScopeFilter } from "./resolve-audit-tenant.js";

const MAX_LIMIT = 100;

function buildDateRange(
  from: string | undefined,
  to: string | undefined,
): { gte?: unknown; lte?: unknown } | null {
  if (!from && !to) return null;
  const range: { gte?: unknown; lte?: unknown } = {};
  if (from) range.gte = Temporal.Instant.from(from);
  if (to) range.lte = Temporal.Instant.from(to);
  return range;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function buildAuditWhere(
  tenantId: string,
  p: {
    aggregateType?: string;
    aggregateId?: string;
    eventType?: string;
    search?: string;
    userId?: string;
    from?: string;
    to?: string;
    cursor?: string;
    before?: string;
  },
): WhereObject {
  const where: WhereObject = { tenantId };
  if (p.aggregateType) where["aggregateType"] = p.aggregateType;
  if (p.aggregateId) where["aggregateId"] = p.aggregateId;
  if (p.eventType) where["type"] = p.eventType;
  else if (p.search) where["type"] = { like: `%${escapeLikePattern(p.search)}%` };
  if (p.userId) where["createdBy"] = p.userId;
  const range = buildDateRange(p.from, p.to);
  if (range) where["createdAt"] = range;
  const cursor = p.cursor ?? p.before;
  if (cursor) where["id"] = { lt: BigInt(cursor) };
  return where;
}

export const listQuery = defineQueryHandler({
  name: "list",
  description:
    'Lists the tenant\'s audit-trail events newest-first with cursor paging, filterable by aggregate type, aggregate id, event type, actor and time range; use it to answer who changed what and when. A SystemAdmin can set scope "system" to read the app-instance system events (e.g. app.started) instead of the own tenant.',
  schema: z
    .object({
      cursor: z.string().regex(/^\d+$/, "cursor must be a positive integer").optional(),
      before: z.string().regex(/^\d+$/, "cursor must be a positive integer").optional(),
      search: z.string().trim().optional(),
      limit: z.number().int().min(1).max(MAX_LIMIT).default(50),
      aggregateType: z.string().optional(),
      aggregateId: z.uuid().optional(),
      eventType: z.string().optional(),
      userId: z.string().optional(),
      sort: z.enum(["createdAt", "type"]).optional(),
      sortDirection: z.enum(["asc", "desc"]).optional(),
      from: z.iso.datetime().optional(),
      to: z.iso.datetime().optional(),
      scope: z.enum(AUDIT_SCOPE_VALUES).optional(),
    })
    .refine((v) => !v.from || !v.to || v.from <= v.to, {
      message: "`from` must be less than or equal to `to`",
      path: ["from"],
    }),
  access: { roles: access.admin },
  handler: async (query, ctx) => {
    const p = query.payload;
    const scopeFilter = resolveAuditScopeFilter(query.user, p.scope);
    const where = buildAuditWhere(scopeFilter.tenantId, {
      ...p,
      aggregateType: scopeFilter.aggregateType ?? p.aggregateType,
    });

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
      orderBy: {
        col: query.payload.sort === "type" ? "type" : "createdAt",
        direction: query.payload.sortDirection ?? "desc",
      },
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
    const nextId = serialised.length === p.limit && last ? last.id : null;
    return {
      rows: serialised,
      nextCursor: nextId,
      nextBefore: nextId,
    };
  },
});
