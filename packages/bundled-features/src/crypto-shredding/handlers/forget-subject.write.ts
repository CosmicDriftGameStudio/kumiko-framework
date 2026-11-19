import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";

import {
  computeBlindIndex,
  configuredBlindIndexKey,
  configuredPiiSubjectKms,
  isSelfPiiField,
  type SubjectId,
  subjectIdSchema,
  subjectIdToKey,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  createEventStoreExecutor,
  type DbRunner,
  fetchOne,
  recordEventsOwnedExclusivelyByTenant,
  recordRowExistsInTenant,
  recordRowOwningTenantId,
  subjectRowExistsInTenant,
  WritePurposes,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineWriteHandler,
  type EntityDefinition,
  type FeatureDefinition,
  findEntity,
  type HandlerContext,
  parseTenantId,
  type SessionUser,
  type TenantId,
  type WriteEvent,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  InternalError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { runInSystemRowLevelSecurityScope } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import {
  appendDomainEventCore,
  assertIrreversibleOperationAllowed,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import type { CrossTenantReads } from "@cosmicdrift/kumiko-types/tenant-db-types";
import * as z from "zod";
import { resolveRetentionPolicyForTenant } from "../../data-retention/index.ts";
import {
  eraseNoteBodiesReachingSubject,
  NOTES_HISTORY_FEATURE_NAME,
} from "../../notes-history/index.ts";
import { revokeAllPatTokensForUser } from "../../personal-access-tokens/index.ts";
import { eraseSubjectData, requireForTenant } from "../../shared/index.ts";
import { USER_STATUS, userTable } from "../../user/index.ts";
import {
  isSystemAdminActor,
  resolveAdminReachOverUser,
  updateUserLifecycle,
} from "../../user-data-rights/index.ts";
import {
  CRYPTO_SHREDDING_AGGREGATE_TYPE,
  CRYPTO_SHREDDING_FEATURE_NAME,
  RECORD_ENTITY_NOT_REGISTERED,
  SUBJECT_FORGET_DENIED_EVENT_NAME,
  SUBJECT_FORGOTTEN_EVENT_NAME,
  TARGET_RECORD_NOT_ADMIN_TENANT,
  TARGET_RECORD_RETENTION_BLOCK_DELETE,
  TARGET_TENANT_NOT_ADMIN_TENANT,
} from "../constants.ts";
import { resolveFileBytesDeleter } from "../resolve-file-bytes-deleter.ts";

export { subjectIdSchema };

export const forgetSubjectSchema = z.object({
  subject: subjectIdSchema,
  reason: z.string().min(10),
});

export const subjectForgottenSchema = z.object({
  subjectKey: z.string().min(1),
  reason: z.string().min(10),
  forgottenBy: z.string().min(1),
});

export const subjectForgetDeniedSchema = z.object({
  subjectKeyDigest: z.string().min(1).optional(),
  subjectKind: z.enum(["user", "tenant", "record"]),
  reason: z.string().min(10),
  forgottenBy: z.string().min(1),
  actorTenantId: z.string().min(1),
  denial: z.string().min(1),
});

type SubjectIdInput = z.infer<typeof subjectIdSchema>;

function subjectOfInput(raw: SubjectIdInput): SubjectId {
  switch (raw.kind) {
    case "user":
      return { kind: "user", userId: raw.userId };
    case "tenant":
      return { kind: "tenant", tenantId: raw.tenantId };
    case "record":
      return { kind: "record", entity: raw.entity, id: raw.id };
    default: {
      const unreachable: never = raw;
      return unreachable;
    }
  }
}

// Tenant-scope guard: DataProtectionOfficer is a tenant-scoped role,
// but the handler otherwise erases ANY subject cross-tenant on a raw
// (un-scoped) client — a Tenant-A DPO who learns a Tenant-B subject id
// (export, support ticket, log line) could destroy it. SystemAdmin
// (platform-wide) always bypasses.
async function resolveTenantScopeDenial(
  db: DbRunner,
  reads: CrossTenantReads,
  features: ReadonlyMap<string, FeatureDefinition>,
  user: SessionUser,
  raw: SubjectIdInput,
): Promise<WriteFailure | undefined> {
  if (isSystemAdminActor(user)) return undefined;

  if (raw.kind === "tenant") {
    if (raw.tenantId === user.tenantId) return undefined;
    return writeFailure(
      new AccessDeniedError({ details: { reason: TARGET_TENANT_NOT_ADMIN_TENANT } }),
    );
  }

  if (raw.kind === "record") {
    // Same fail-open rule as the user branch below — without the tenant
    // feature there is no tenant concept to enforce.
    if (!features.has("tenant")) return undefined;
    // The record subject names its own entity — resolve it against the registry
    // instead of trusting the payload straight into resolveTableName/SQL.
    const entity = findEntity(features, raw.entity);
    const rowInTenant =
      entity !== undefined &&
      (await recordRowExistsInTenant(db, features, raw.entity, raw.id, user.tenantId));
    if (rowInTenant) return undefined;
    // A deleted row or a custom aggregate without an entity has no projection
    // row to check; its event stream still proves which tenant owns it.
    if (await recordEventsOwnedExclusivelyByTenant(db, raw.entity, raw.id, user.tenantId)) {
      return undefined;
    }
    return writeFailure(
      new AccessDeniedError({
        details: {
          reason: entity ? TARGET_RECORD_NOT_ADMIN_TENANT : RECORD_ENTITY_NOT_REGISTERED,
        },
      }),
    );
  }

  // Without the tenant feature there's no membership table to check against —
  // no scoping concept exists to enforce (single/no-tenant apps only;
  // ponytail: fail-open here, not a gap in multi-tenant apps).
  if (!features.has("tenant")) return undefined;

  const reach = await resolveAdminReachOverUser(reads, user, raw.userId, features.has("user"));
  if (reach.kind === "within-reach") return undefined;

  // Only a subject without any membership may still be a self-owned PII subject
  // (share-token recipient, email subscriber, ...) whose own row carries a real
  // tenant_id. A real user beyond the admin's reach never falls back.
  if (!reach.hasNoMembership) return reach.denial;
  const ownedInTenant = await subjectRowExistsInTenant(db, features, raw.userId, user.tenantId);
  return ownedInTenant ? undefined : reach.denial;
}

// blockDelete (legally mandated physical retention, e.g.
// ledger/invoice text) means this command must refuse, not silently
// anonymize or proceed. Refused when the host entity itself declares
// blockDelete OR the owning tenant's effective data-retention policy
// (preset/override layering) does, so a tenant preset cannot be bypassed here.
// The entity declaration is checked first and independent of the tenant
// feature/gate and of data-retention being mounted: a retention obligation
// holds in single-tenant apps too.
async function resolveRetentionDenial(
  ctx: HandlerContext,
  raw: SubjectIdInput,
  // Lazy: unsafeRaw writes an audit entry per call, so only request it once a read is needed.
  getRunner: () => DbRunner,
): Promise<WriteFailure | undefined> {
  if (raw.kind !== "record") return undefined;
  const features = ctx.registry.features;
  const deny = () =>
    writeFailure(
      new AccessDeniedError({ details: { reason: TARGET_RECORD_RETENTION_BLOCK_DELETE } }),
    );
  const entity = findEntity(features, raw.entity);
  if (entity?.retention?.strategy === "blockDelete") return deny();
  if (!features.has("data-retention")) return undefined;

  // The row's own tenant, not the actor's: a SystemAdmin acts across tenants.
  const runner = getRunner();
  const owningTenantId = await recordRowOwningTenantId(runner, features, raw.entity, raw.id);
  if (owningTenantId === undefined) return undefined;
  const effective = await resolveRetentionPolicyForTenant({
    db: runner,
    registry: ctx.registry,
    tenantId: owningTenantId,
    entityName: raw.entity,
  });
  return effective.policy?.strategy === "blockDelete" ? deny() : undefined;
}

// The tenant that owns a record subject's row; the file purge is scoped to it.
async function owningTenantOfRecordSubject(
  runner: DbRunner,
  features: ReadonlyMap<string, FeatureDefinition>,
  raw: SubjectIdInput,
): Promise<TenantId | undefined> {
  if (raw.kind !== "record") return undefined;
  const owner = await recordRowOwningTenantId(runner, features, raw.entity, raw.id);
  return parseTenantId(owner) ?? undefined;
}

// AccessDeniedError.code is the generic "access_denied" for every branch;
// the specific branch lives in details.reason.
function denialReasonOf(failure: WriteFailure): string {
  const details = failure.error.details;
  if (typeof details === "object" && details !== null && "reason" in details) {
    const { reason } = details;
    if (typeof reason === "string") return reason;
  }
  return failure.error.code;
}

// Denied cross-tenant probes must still leave an audit trail.
// Appended outside the handler tx: the caller's
// `return tenantScopeDenial` rolls that tx back.
async function appendDenialAuditEvent(
  ctx: HandlerContext,
  event: WriteEvent<z.infer<typeof forgetSubjectSchema>>,
  subjectKey: string,
  subjectKind: SubjectIdInput["kind"],
  denialCode: string,
  denialAuditRunner: DbRunner | undefined,
): Promise<WriteFailure | null> {
  if (!denialAuditRunner) {
    return writeFailure(
      new InternalError({
        message:
          "[crypto-shredding] forget-subject denial audit event cannot be appended without " +
          "ctx.db.outsideTransaction — dispatch wiring is missing the outside-tx db source.",
      }),
    );
  }
  const blindIndexKey = configuredBlindIndexKey();
  const payload: z.infer<typeof subjectForgetDeniedSchema> = {
    // The denial lands in the REQUESTING actor's own tenant-scoped stream —
    // it must never materialise the foreign subject's identifiers there. A
    // plaintext subjectKey/aggregateId would survive as a permanent record
    // for the prober and would still be present when the owning tenant
    // later runs its own (legitimate) forget-subject for that subject. The
    // digest is keyed (a bare hash of a guessable id could be recomputed from
    // a candidate id) and lets an operator correlate repeated probes of the
    // same subject; without a blind-index key no digest is stored at all.
    ...(blindIndexKey !== undefined && {
      subjectKeyDigest: computeBlindIndex(blindIndexKey, subjectKey),
    }),
    subjectKind,
    reason: event.payload.reason,
    forgottenBy: event.user.id,
    actorTenantId: event.user.tenantId,
    denial: denialCode,
  };
  await appendDomainEventCore(
    {
      registry: ctx.registry,
      db: denialAuditRunner,
      // MUST be event.user.tenantId, never SYSTEM_TENANT_ID — unsafeRaw
      // bypasses TenantDb's scoping, so this is the only guard against a cross-tenant denial event.
      tenantId: event.user.tenantId,
      userId: String(event.user.id),
      callSiteLabel: "forget-subject denial audit",
      callerFeature: CRYPTO_SHREDDING_FEATURE_NAME,
    },
    {
      // Fresh stream per denial: no version to read, nothing to conflict with.
      aggregateId: generateId(),
      aggregateType: CRYPTO_SHREDDING_AGGREGATE_TYPE,
      type: SUBJECT_FORGET_DENIED_EVENT_NAME,
      payload,
      expectedVersion: 0,
    },
  );
  return null;
}

// Email subscribers and other non-user entities use user-style subject keys without a read_users row: no row means no door to close.
// Runs in the forget's transaction, so a later failure rolls the door back with everything else and a retry redoes it.
async function closeUserLoginDoor(
  ctx: HandlerContext,
  userId: string,
  runner: DbRunner,
): Promise<void> {
  const userRow = await fetchOne(runner, userTable, { id: userId });
  // skip: no user row for this subject key (e.g. email subscribers); there is no door to close.
  if (!userRow) return;

  await updateUserLifecycle(
    runner,
    userId,
    { status: USER_STATUS.Deleted },
    // includeDeleted: a user whose stream is already deleted but whose status
    // still reads active would otherwise fail with not_found (500) and keep
    // sessions and PATs alive.
    { writePurpose: WritePurposes.erasure, includeDeleted: true },
  );
  if (ctx.registry.features.has("personal-access-tokens")) {
    await revokeAllPatTokensForUser(runner, userId);
  }
}

// The row id a forgetWithSubject entity keys its own subject on, if this subject is one of its rows.
function ownRowIdOfSubject(
  subject: SubjectId,
  entityName: string,
  entity: EntityDefinition,
): string | undefined {
  switch (subject.kind) {
    case "record":
      return subject.entity === entityName ? subject.id : undefined;
    case "user":
      return Object.values(entity.fields).some(isSelfPiiField) ? subject.userId : undefined;
    case "tenant":
      return undefined;
    default: {
      const unreachable: never = subject;
      return unreachable;
    }
  }
}

// Rows that exist only for their subject (subscriber, share recipient) go with it, through the
// executor so the forgotten event, child projections and stream close happen like any forget.
async function forgetSubjectRows(ctx: HandlerContext, subject: SubjectId): Promise<void> {
  const features = ctx.registry.features;
  for (const proj of ctx.registry.getAllProjections().values()) {
    if (proj.isImplicit !== true || typeof proj.source !== "string" || !proj.table) continue;
    const entityName = proj.source;
    const entity = ctx.registry.getEntity(entityName);
    if (entity?.forgetWithSubject !== true) continue;
    const rowId = ownRowIdOfSubject(subject, entityName, entity);
    if (rowId === undefined) continue;
    const rowTenantId = parseTenantId(
      await recordRowOwningTenantId(ctx.db.unsafeRawAllTenants(), features, entityName, rowId),
    );
    // skip: no live row (never existed, already forgotten, or hard-deleted by the calling handler)
    if (!rowTenantId) continue;
    if (features.has("data-retention")) {
      const effective = await resolveRetentionPolicyForTenant({
        db: ctx.db.unsafeRawAllTenants(),
        registry: ctx.registry,
        tenantId: rowTenantId,
        entityName,
      });
      // skip: a tenant's blockDelete keeps the row; the key erase still shreds its PII
      if (effective.policy?.strategy === "blockDelete") continue;
    }
    const target = requireForTenant(ctx, rowTenantId);
    const result = await createEventStoreExecutor(proj.table, entity, { entityName }).forget(
      { id: rowId },
      createSystemUser(rowTenantId),
      target.db,
      target.streamTenantId ? { streamTenantId: target.streamTenantId } : undefined,
    );
    if (!result.isSuccess) {
      throw new InternalError({
        message: `[crypto-shredding] forget-subject could not forget its ${entityName} row (${result.error.code})`,
      });
    }
  }
}

// Manual crypto-shred for a DPO / platform operator. Forgets the subject's opted-in rows and derived data (for a user also, when opted in, the record keys of rows the user owns) and appends subject-forgotten in one transaction; the subject-key-eraser consumer erases the DEK after commit (reads then render "[[erased]]").
// Forget is final — the adapter keeps a tombstone. The automated Art.-17 path (user-data-rights forget-cleanup) erases keys inside its per-user sub-tx and shares the erasure core (eraseSubjectData).
export type ForgetSubjectOptions = {
  /** Opt-in, default off: forgetting a user also erases the record keys of rows the user owns. */
  readonly eraseOwnedRecordKeys?: boolean;
};

export function createForgetSubjectWrite(opts: ForgetSubjectOptions = {}) {
  return defineWriteHandler({
    name: "forget-subject",
    schema: forgetSubjectSchema,
    access: { roles: [ROLES.DataProtectionOfficer, ROLES.SystemAdmin] },
    description:
      "Irreversibly crypto-shreds one user, tenant or record subject: forgets the rows of entities that declare forgetWithSubject, and, when the app opts in with eraseOwnedRecordKeys, erases the record keys of rows the user owns, purges its search documents, files and blind indexes, closes the user's login and has its encryption key erased right after commit, for supervisory-authority requests and operator recovery outside the automated Art. 17 cleanup pipeline.",
    // Erasing the subject key is irreversible: there is no undo, so an agent must
    // not be able to reach it at all.
    agent: { expose: false, risk: "high" },
    escapeHatch: {
      grants: ["crossTenantReads", "unsafeRaw"],
      reason:
        "the subject user's memberships and roles are read across tenants via crossTenantReads; the denial audit appends name the caller's own tenant stream on the outside-transaction db; " +
        "the tenant-scope and retention checks and the row-owner lookups run against the subject's tenant, not necessarily the caller's; " +
        "the blind-index sweep, search purge and file purge address the subject across tenants; " +
        "the subject-forgotten events of owned record subjects land in each row's own tenant; " +
        "the user lifecycle update and PAT revoke run on the SYSTEM user stream.",
    },
    handler: async (event, ctx) => {
      assertIrreversibleOperationAllowed("forget-subject key erase");
      // Without a KMS the consumer could never erase the key.
      if (!configuredPiiSubjectKms()) {
        return writeFailure(
          new InternalError({
            message:
              "[crypto-shredding] forget-subject called but no KMS adapter is configured — " +
              "pass runProdApp({ kms }) / configurePiiSubjectKms(adapter) at boot.",
          }),
        );
      }

      const raw = event.payload.subject;
      const subject = subjectOfInput(raw);
      const subjectKey = subjectIdToKey(subject);

      const tenantScopeDenial = await resolveTenantScopeDenial(
        ctx.db.unsafeRawAllTenants(),
        ctx.crossTenantReads,
        ctx.registry.features,
        event.user,
        raw,
      );
      if (tenantScopeDenial) {
        const auditFailure = await appendDenialAuditEvent(
          ctx,
          event,
          subjectKey,
          raw.kind,
          denialReasonOf(tenantScopeDenial),
          ctx.db.outsideTransaction?.unsafeRawAllTenants(),
        );
        return auditFailure ?? tenantScopeDenial;
      }

      // Runs after the tenant gate but before any key is touched: a retention
      // check ahead of the tenant gate would leak a foreign entity's retention
      // posture to a cross-tenant prober.
      const retentionDenial = await resolveRetentionDenial(ctx, raw, () =>
        ctx.db.unsafeRawAllTenants(),
      );
      if (retentionDenial) {
        const auditFailure = await appendDenialAuditEvent(
          ctx,
          event,
          subjectKey,
          raw.kind,
          TARGET_RECORD_RETENTION_BLOCK_DELETE,
          ctx.db.outsideTransaction?.unsafeRawAllTenants(),
        );
        return auditFailure ?? retentionDenial;
      }

      const requestId = requestContext.get()?.requestId ?? "crypto-shredding:forget-subject";
      // Everything below runs in the handler transaction: a failure rolls the whole forget back and
      // a retry redoes it. The key is erased only after commit, by the subject-key-eraser consumer.
      const crossTenantRunner = ctx.db.unsafeRawAllTenants();
      // DEK erase makes passwordHash unreadable, but status and PATs are separate credentials: the PAT
      // resolver only checks revokedAt/expiresAt. Sessions re-check the user row on every request.
      if (raw.kind === "user" && ctx.registry.features.has("user")) {
        await closeUserLoginDoor(ctx, raw.userId, crossTenantRunner);
      }
      const recordTenantId = await owningTenantOfRecordSubject(
        crossTenantRunner,
        ctx.registry.features,
        raw,
      );
      const ownedRecordSubjects = await eraseSubjectData({
        registry: ctx.registry,
        db: crossTenantRunner,
        subject,
        searchAdapter: ctx.services.searchAdapter,
        eraseOwnedRecordKeys: opts.eraseOwnedRecordKeys === true,
        ...(recordTenantId !== undefined && { recordTenantId }),
        resolveDeleteBytes: resolveFileBytesDeleter(ctx),
        missingStorage: { mode: "fail" },
        eraseRows: async () => {
          await forgetSubjectRows(ctx, subject);
          // Note bodies are keyed per note, so the subject's own key never reaches them.
          if (ctx.registry.features.has(NOTES_HISTORY_FEATURE_NAME)) {
            await eraseNoteBodiesReachingSubject({
              db: crossTenantRunner,
              subject,
              erasedBy: event.user.id,
              requestId,
            });
          }
        },
      });
      // Fresh stream: the subject's own id may be an entity stream this forget just closed.
      await ctx.events.unsafeAppend({
        aggregateId: generateId(),
        aggregateType: CRYPTO_SHREDDING_AGGREGATE_TYPE,
        type: SUBJECT_FORGOTTEN_EVENT_NAME,
        payload: { subjectKey, reason: event.payload.reason, forgottenBy: event.user.id },
        expectedVersion: 0,
      });
      // No tenant or retention filter: pii/record-key-one-owner keeps these keys to the owner's data, which the user-key erase shreds in every tenant anyway.
      for (const owned of ownedRecordSubjects) {
        // In the row's own tenant: the actor's stream must not carry another tenant's row ids.
        await runInSystemRowLevelSecurityScope(
          "an owned record's subject-forgotten event lands in the row's own tenant",
          () =>
            appendDomainEventCore(
              {
                registry: ctx.registry,
                db: crossTenantRunner,
                tenantId: owned.tenantId,
                userId: String(event.user.id),
                callSiteLabel: "forget-subject owned record",
                callerFeature: CRYPTO_SHREDDING_FEATURE_NAME,
              },
              {
                aggregateId: generateId(),
                aggregateType: CRYPTO_SHREDDING_AGGREGATE_TYPE,
                type: SUBJECT_FORGOTTEN_EVENT_NAME,
                payload: {
                  subjectKey: subjectIdToKey(owned.subject),
                  reason: event.payload.reason,
                  forgottenBy: event.user.id,
                },
                expectedVersion: 0,
              },
            ),
        );
      }
      return { isSuccess: true as const, data: { subjectKey } };
    },
  });
}

export const forgetSubjectWrite = createForgetSubjectWrite();
