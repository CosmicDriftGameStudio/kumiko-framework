// Query building and row mapping shared by every audit read handler, so the own-tenant
// and the all-tenants variants cannot drift apart. The tenant condition is the only part
// that differs per handler and is passed in.
//
// Event payloads hold PII as subject-KMS ciphertext; it is replaced by
// REDACTED_PII_PLACEHOLDER before returning, since the API leak guard refuses ciphertext.

import { selectMany, type TenantDb, type WhereObject } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { redactPiiCiphertext } from "../../shared/index.ts";

const MAX_LIMIT = 100;

export const auditListPayloadShape = {
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
} as const;

export const auditEventIdSchema = z.string().regex(/^[1-9]\d*$/, "id must be a positive integer");

export const AUDIT_DATE_RANGE_CHECK = {
  isValid: (v: { from?: string | undefined; to?: string | undefined }): boolean =>
    !v.from || !v.to || v.from <= v.to,
  params: {
    message: "`from` must be less than or equal to `to`",
    path: ["from"],
  },
};

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

export type AuditListFilters = {
  aggregateType?: string | undefined;
  aggregateId?: string | undefined;
  eventType?: string | undefined;
  search?: string | undefined;
  userId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  cursor?: string | undefined;
  before?: string | undefined;
};

/** `tenantCondition` is a tenant id, or an operator object for reads across tenants. */
export function buildAuditWhere(
  tenantCondition: unknown,
  p: AuditListFilters,
  direction: "asc" | "desc",
): WhereObject {
  const where: WhereObject = { tenantId: tenantCondition };
  if (p.aggregateType) where["aggregateType"] = p.aggregateType;
  if (p.aggregateId) where["aggregateId"] = p.aggregateId;
  if (p.eventType) where["type"] = p.eventType;
  else if (p.search) where["type"] = { like: `%${escapeLikePattern(p.search)}%` };
  if (p.userId) where["createdBy"] = p.userId;
  const range = buildDateRange(p.from, p.to);
  if (range) where["createdAt"] = range;
  const cursor = p.cursor ?? p.before;
  // The cursor is an event id, so it only walks pages in id order: ascending
  // pages continue past it, descending pages stop before it.
  if (cursor) where["id"] = direction === "asc" ? { gt: BigInt(cursor) } : { lt: BigInt(cursor) };
  return where;
}

type AuditEventRow = {
  id: bigint;
  tenantId: string;
  aggregateId: string;
  aggregateType: string;
  version: number;
  type: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: unknown;
  createdBy: string;
};

export function serializeAuditEvent(r: AuditEventRow) {
  return {
    id: String(r.id),
    tenantId: r.tenantId,
    aggregateId: r.aggregateId,
    aggregateType: r.aggregateType,
    version: r.version,
    type: r.type,
    payload: redactPiiCiphertext(r.payload),
    metadata: r.metadata,
    createdAt: r.createdAt,
    createdBy: r.createdBy,
  };
}

export async function loadAuditEvent(db: TenantDb, where: WhereObject) {
  const rows = await selectMany<AuditEventRow>(db, eventsTable, where, { limit: 1 });
  const row = rows[0];
  return row === undefined ? null : serializeAuditEvent(row);
}

export async function listAuditEvents(
  db: TenantDb,
  where: WhereObject,
  p: { limit: number; sort?: "createdAt" | "type" | undefined },
  direction: "asc" | "desc",
) {
  const rows = await selectMany<AuditEventRow>(db, eventsTable, where, {
    // The id cursor only resumes an id-ordered listing. created_at comes from the
    // transaction start and can run against insert order, so ordering by it would let
    // a page boundary skip rows; only the type sort leaves id order (and is one page).
    orderBy:
      p.sort === "type"
        ? [
            { col: "type", direction },
            { col: "id", direction },
          ]
        : [{ col: "id", direction }],
    limit: p.limit,
  });
  const serialised = rows.map(serializeAuditEvent);
  const last = serialised[serialised.length - 1];
  // An id cursor cannot resume a type-ordered listing, so that sort is one page.
  const nextId = serialised.length === p.limit && last && p.sort !== "type" ? last.id : null;
  return { rows: serialised, nextCursor: nextId, nextBefore: nextId };
}
