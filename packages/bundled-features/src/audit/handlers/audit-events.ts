// Query building and row mapping shared by every audit read handler, so the own-tenant
// and the all-tenants variants cannot drift apart. The tenant condition is the only part
// that differs per handler and is passed in.
//
// Event payloads hold PII as subject-KMS ciphertext; it is replaced by
// REDACTED_PII_PLACEHOLDER before returning (payload and metadata), since the API leak guard refuses ciphertext.

import { selectMany, type TenantDb, type WhereObject } from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { redactPiiCiphertext } from "../../shared/index.ts";
import { eventLabelKeyOf, TECHNICAL_EVENT_TYPES } from "../event-classification.ts";
import {
  AUDIT_EVENT_ACTIONS,
  type AuditEventAction,
  INCLUDE_TECHNICAL_FILTER,
} from "../web/constants.ts";

const MAX_LIMIT = 100;

// At most 18 digits keeps the id inside bigint, so an oversized cursor or id is a 422, not a 500.
const CURSOR_PATTERN = /^\d{1,18}$/;

export const auditListPayloadShape = {
  cursor: z.string().regex(CURSOR_PATTERN, "cursor must be a positive integer").optional(),
  before: z.string().regex(CURSOR_PATTERN, "cursor must be a positive integer").optional(),
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

// The technical-entries facet rides on the `type` column (facets need a declared column).
export const technicalEntriesFilterSchema = z.strictObject({
  field: z.literal("type"),
  op: z.literal("in"),
  value: z.array(z.literal(INCLUDE_TECHNICAL_FILTER)).max(1),
});

export function includesTechnicalEntries(
  filters: readonly { readonly field: string; readonly value: readonly unknown[] }[] | undefined,
): boolean {
  return (
    filters?.some((f) => f.field === "type" && f.value.includes(INCLUDE_TECHNICAL_FILTER)) ?? false
  );
}

export const auditEventIdSchema = z
  .string()
  .regex(/^[1-9]\d{0,17}$/, "id must be a positive integer");

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
  includeTechnical?: boolean | undefined;
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
  else if (p.search || !p.includeTechnical) {
    where["type"] = {
      ...(p.search && { like: `%${escapeLikePattern(p.search)}%` }),
      ...(!p.includeTechnical && { notIn: TECHNICAL_EVENT_TYPES }),
    };
  }
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

function eventActionOf(type: string): AuditEventAction | null {
  const suffix = type.slice(type.lastIndexOf(".") + 1);
  return type.includes(".") ? (AUDIT_EVENT_ACTIONS.find((a) => a === suffix) ?? null) : null;
}

// Entity events carry the entity name as aggregateType; the noun key is the
// renderer's own `<feature>:entity:<entity>:noun` convention.
export type EntityNounKeyResolver = (aggregateType: string) => string | null;

export function createEntityNounKeyResolver(registry: Registry | undefined): EntityNounKeyResolver {
  const featureByEntity = new Map<string, string>();
  for (const [featureName, feature] of registry?.features ?? []) {
    for (const entityName of Object.keys(feature.entities ?? {})) {
      featureByEntity.set(entityName, featureName);
    }
  }
  return (aggregateType) => {
    const featureName = featureByEntity.get(aggregateType);
    return featureName === undefined ? null : `${featureName}:entity:${aggregateType}:noun`;
  };
}

export function serializeAuditEvent(r: AuditEventRow, nounKeyOf: EntityNounKeyResolver) {
  return {
    id: String(r.id),
    tenantId: r.tenantId,
    aggregateId: r.aggregateId,
    aggregateType: r.aggregateType,
    version: r.version,
    type: r.type,
    eventAction: eventActionOf(r.type),
    eventLabelKey: eventLabelKeyOf(r.type),
    entityNounKey: nounKeyOf(r.aggregateType),
    payload: redactPiiCiphertext(r.payload),
    metadata: redactPiiCiphertext(r.metadata),
    createdAt: r.createdAt,
    createdBy: r.createdBy,
  };
}

export async function loadAuditEvent(
  db: TenantDb,
  where: WhereObject,
  nounKeyOf: EntityNounKeyResolver,
) {
  const rows = await selectMany<AuditEventRow>(db, eventsTable, where, { limit: 1 });
  const row = rows[0];
  return row === undefined ? null : serializeAuditEvent(row, nounKeyOf);
}

export async function listAuditEvents(
  db: TenantDb,
  where: WhereObject,
  p: { limit: number; sort?: "createdAt" | "type" | undefined },
  direction: "asc" | "desc",
  nounKeyOf: EntityNounKeyResolver,
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
  const serialised = rows.map((row) => serializeAuditEvent(row, nounKeyOf));
  const last = serialised[serialised.length - 1];
  // An id cursor cannot resume a type-ordered listing, so that sort is one page.
  const nextId = serialised.length === p.limit && last && p.sort !== "type" ? last.id : null;
  return { rows: serialised, nextCursor: nextId, nextBefore: nextId };
}
