import {
  deleteMany,
  type EntityTableMeta,
  index,
  instant,
  jsonb,
  table as pgTable,
  requireEntityTableMeta,
  type TenantDb,
  text,
  uuid,
} from "@cosmicdrift/kumiko-framework/db";
import type {
  HandlerContext,
  Registry,
  TenantDataHookCtx,
  TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import * as z from "zod";
import { resolveAuditRetentionCutoff } from "./audit-retention-cutoff.ts";
import { AUDIT_FEATURE } from "./web/constants.ts";

export type AccessLogDetails = Readonly<Record<string, string | number | boolean>>;

const ACCESS_LOG_SUBJECT_INDEX =
  "store_access_log_tenant_id_subject_type_subject_id_occurred_at_idx";
const ACCESS_LOG_OCCURRED_INDEX = "store_access_log_tenant_id_occurred_at_idx";

// A read changes no state. As an event it would bloat the event store and sit in the caller's
// transaction, which rolls back on failure. So accesses are rows with a retention period here.
// Rows hold ids and codes only, no personal data, hence no PII encryption.
export const accessLogTable = pgTable(
  "store_access_log",
  {
    id: uuid("id").primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    occurredAt: instant("occurred_at").notNull(),
    actorId: text("actor_id").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    action: text("action").notNull(),
    details: jsonb("details").notNull().$type<AccessLogDetails>(),
  },
  (t) => [
    index(ACCESS_LOG_SUBJECT_INDEX).on(t.tenantId, t.subjectType, t.subjectId, t.occurredAt),
    index(ACCESS_LOG_OCCURRED_INDEX).on(t.tenantId, t.occurredAt),
  ],
);

export const accessLogTableMeta: EntityTableMeta = requireEntityTableMeta(
  accessLogTable,
  "accessLogTable",
);

export const accessLogEntrySchema = z
  .object({
    subjectType: z.string().min(1).max(64),
    subjectId: z.string().min(1).max(128),
    action: z.string().min(1).max(64),
    details: z
      .record(z.string().max(64), z.union([z.string().max(200), z.number(), z.boolean()]))
      .refine((d) => Object.keys(d).length <= 20)
      .optional(),
  })
  .strict();

export type AccessLogEntry = z.infer<typeof accessLogEntrySchema>;

export async function recordAccess(
  ctx: Pick<HandlerContext, "db" | "systemDb" | "user" | "tz">,
  entry: AccessLogEntry,
): Promise<void> {
  const parsed = accessLogEntrySchema.parse(entry);
  const db = ctx.systemDb
    ? ctx.systemDb.outsideTransaction.assertTenantMatch(ctx.user.tenantId)
    : ctx.db.outsideTransaction;
  if (!db) {
    throw new InternalError({
      message:
        "audit: recordAccess needs ctx.db.outsideTransaction, which this handler phase does not provide",
    });
  }
  // Written outside the caller's transaction: an access whose handler fails afterwards stays
  // logged, and query handlers can log as well.
  await db.insertOne(accessLogTable, {
    id: generateId(),
    tenantId: ctx.user.tenantId,
    occurredAt: ctx.tz.now(),
    actorId: ctx.user.id,
    subjectType: parsed.subjectType,
    subjectId: parsed.subjectId,
    action: parsed.action,
    details: parsed.details ?? {},
  });
}

export async function pruneExpiredAccessLog(args: {
  readonly db: TenantDb;
  readonly registry: Registry;
  readonly tenantId: TenantId;
  readonly now: Temporal.Instant;
}): Promise<number> {
  const cutoff = await resolveAuditRetentionCutoff(args);
  // ponytail: one deleteMany per tenant run; batch it if a tenant collects millions of expired rows between maintenance runs
  return args.db.deleteMany(accessLogTable, {
    tenantId: args.tenantId,
    occurredAt: { lt: cutoff },
  });
}

export async function accessLogTenantDestroyHook(ctx: TenantDataHookCtx): Promise<void> {
  // skip: audit is optional for tenant-lifecycle, without it the table does not exist
  if (!ctx.registry.getFeature(AUDIT_FEATURE)) return;
  await deleteMany(ctx.db, accessLogTable, { tenantId: ctx.tenantId });
}
