import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { runInSavepointIfSupported } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  computeBlindIndex,
  configuredBlindIndexKey,
  configuredPiiSubjectKms,
  type SubjectId,
  subjectIdSchema,
  subjectIdToKey,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  type DbRunner,
  nullBlindIndexesForSubject,
  recordEventsOwnedExclusivelyByTenant,
  recordRowExistsInTenant,
  recordRowOwningTenantId,
  subjectRowExistsInTenant,
} from "@cosmicdrift/kumiko-framework/db";
import {
  defineWriteHandler,
  type EntityDefinition,
  type FeatureDefinition,
  type HandlerContext,
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
import {
  appendDomainEventCore,
  assertIrreversibleOperationAllowed,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { purgeSearchDocumentsForSubject } from "@cosmicdrift/kumiko-framework/search";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import * as z from "zod";
import { resolveRetentionPolicyForTenant } from "../../data-retention/index.js";
import { revokeAllPatTokensForUser } from "../../personal-access-tokens/index.js";
import { USER_STATUS } from "../../user/index.js";
import {
  denyIfTargetOutsideAdminTenant,
  isSystemAdminActor,
  updateUserLifecycle,
} from "../../user-data-rights/index.js";
import {
  CRYPTO_SHREDDING_AGGREGATE_TYPE,
  CRYPTO_SHREDDING_FEATURE_NAME,
  RECORD_ENTITY_NOT_REGISTERED,
  SUBJECT_FORGET_DENIED_EVENT_NAME,
  SUBJECT_FORGOTTEN_EVENT_NAME,
  TARGET_RECORD_NOT_ADMIN_TENANT,
  TARGET_RECORD_RETENTION_BLOCK_DELETE,
  TARGET_TENANT_NOT_ADMIN_TENANT,
} from "../constants.js";

export { subjectIdSchema };

export const forgetSubjectSchema = z.object({
  subject: subjectIdSchema,
  reason: z.string().min(10),
});

export const subjectForgottenSchema = z.object({
  subjectKey: z.string().min(1),
  reason: z.string().min(10),
  forgottenBy: z.string().min(1),
  // Error code or name of a failed derived-data sweep, never its message (which
  // can name the subject). Present only when the handler failed after the erase.
  cleanupError: z.string().min(1).optional(),
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

// Exhaustive switch so a 4th subject kind fails to compile instead of
// silently aggregating under the wrong id.
function subjectAggregateId(raw: SubjectIdInput): string {
  switch (raw.kind) {
    case "user":
      return raw.userId;
    case "tenant":
      return raw.tenantId;
    case "record":
      return raw.id;
    default: {
      const exhaustiveCheck: never = raw;
      throw new Error(`Unhandled subject kind: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

// The record subject names its own entity — resolve it against the registry
// instead of trusting the payload straight into resolveTableName/SQL (#2786).
function findRegisteredEntity(
  features: ReadonlyMap<string, FeatureDefinition>,
  entityName: string,
): EntityDefinition | undefined {
  for (const feature of features.values()) {
    const entity = feature.entities?.[entityName];
    if (entity) return entity;
  }
  return undefined;
}

// Tenant-scope guard (mh#349): DataProtectionOfficer is a tenant-scoped role,
// but the handler otherwise erases ANY subject cross-tenant on a raw
// (un-scoped) client — a Tenant-A DPO who learns a Tenant-B subject id
// (export, support ticket, log line) could destroy it. SystemAdmin
// (platform-wide) always bypasses.
async function resolveTenantScopeDenial(
  db: DbRunner,
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
    const entity = findRegisteredEntity(features, raw.entity);
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

  const memberDenied = await denyIfTargetOutsideAdminTenant(db, user, raw.userId);
  if (!memberDenied) return undefined;

  // Not a real user in the actor's tenant — raw.userId may still be a
  // self-owned PII subject (share-token recipient, email subscriber, ...)
  // whose own row carries a real tenant_id.
  const ownedInTenant = await subjectRowExistsInTenant(db, features, raw.userId, user.tenantId);
  return ownedInTenant ? undefined : memberDenied;
}

// fw#2789/#2805: blockDelete (legally mandated physical retention, e.g.
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
  const entity = findRegisteredEntity(features, raw.entity);
  if (entity?.retention?.strategy === "blockDelete") return deny();
  if (!features.has("data-retention")) return undefined;

  // The row's own tenant, not the actor's: a SystemAdmin acts across tenants.
  const runner = getRunner();
  const owningTenantId = await recordRowOwningTenantId(runner, features, raw.entity, raw.id);
  if (owningTenantId === undefined) return undefined;
  const effective = await resolveRetentionPolicyForTenant({
    db: runner,
    registry: ctx.registry,
    tenantId: owningTenantId as TenantId,
    entityName: raw.entity,
  });
  return effective.policy?.strategy === "blockDelete" ? deny() : undefined;
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

// Denied cross-tenant probes must still leave an audit trail (fw#2348).
// Appended outside the handler tx (fw#2592): the caller's
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
          "ctx.dbOutsideTransaction — dispatch wiring is missing the outside-tx db source.",
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
      // bypasses TenantDb's scoping, so this is the only guard against a cross-tenant denial event (fw#2452).
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
    },
  );
  return null;
}

// Name or driver code of the error, never its message: a message can carry the
// subject key or row values and would land in a permanent audit event.
function sweepErrorLabel(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = err.code;
    if (typeof code === "string" && code.length > 0) return code;
  }
  return err instanceof Error && err.name.length > 0 ? err.name : "UnknownError";
}

// The key is already erased when this runs, so a failing sweep must not skip the
// audit event: the failure is returned as a label for the event instead of thrown.
// The savepoint keeps a database error from aborting the handler transaction.
async function sweepDerivedSubjectData(
  ctx: HandlerContext,
  subject: SubjectId,
  subjectKey: string,
  crossTenantRunner: DbRunner,
): Promise<string | undefined> {
  try {
    await runInSavepointIfSupported(crossTenantRunner, async (crossTenantSubjectRunner) => {
      // Blind-index sweep (#818): nulls bidx columns now so the deterministic
      // HMAC doesn't stay equality-matchable; raw because the ciphertext prefix addresses the subject across tenants.
      await nullBlindIndexesForSubject(crossTenantSubjectRunner, ctx.registry.features, subjectKey);

      // Derived search index still holds plaintext (#1610) — purge next to the
      // blind-index sweep. No adapter → no-op (apps without search).
      if (ctx.searchAdapter) {
        await purgeSearchDocumentsForSubject(
          crossTenantSubjectRunner,
          ctx.registry.features,
          ctx.searchAdapter,
          subjectKey,
          subject,
        );
      }
    });
    return undefined;
  } catch (err) {
    return sweepErrorLabel(err);
  }
}

// Graceful fail: email-subscribers and other non-user entities may use
// user-style subject keys without having an actual user row — the key erase is
// the important part for GDPR compliance; the lifecycle update is best-effort for
// real users. The savepoint confines the failure so the handler transaction
// stays usable for the audit event.
async function closeUserLoginDoorBestEffort(
  ctx: HandlerContext,
  userId: string,
  lifecycleRunner: DbRunner,
): Promise<void> {
  try {
    await runInSavepointIfSupported(lifecycleRunner, async (userLifecycleRunner) => {
      await updateUserLifecycle(userLifecycleRunner, userId, { status: USER_STATUS.Deleted });
      if (ctx.registry.features.has("personal-access-tokens")) {
        await revokeAllPatTokensForUser(userLifecycleRunner, userId);
      }
    });
  } catch {
    // skip: no user row for this subject key (e.g. email subscribers); key erase and sweeps already ran.
  }
}

// Through the outside-transaction db when available, so the audit event commits
// even though the handler may fail afterwards (sweep error) and roll back its own
// transaction. Without that source the event stays in the handler transaction.
async function appendSubjectForgotten(
  ctx: HandlerContext,
  event: WriteEvent<z.infer<typeof forgetSubjectSchema>>,
  aggregateId: string,
  payload: z.infer<typeof subjectForgottenSchema>,
  outsideRunner: DbRunner | undefined,
): Promise<void> {
  if (!outsideRunner) {
    await ctx.unsafeAppendEvent({
      aggregateId,
      aggregateType: CRYPTO_SHREDDING_AGGREGATE_TYPE,
      type: SUBJECT_FORGOTTEN_EVENT_NAME,
      payload,
    });
  } else {
    await appendDomainEventCore(
      {
        registry: ctx.registry,
        db: outsideRunner,
        // MUST be event.user.tenantId, never SYSTEM_TENANT_ID — unsafeRaw bypasses TenantDb's scoping (fw#2452).
        tenantId: event.user.tenantId,
        userId: String(event.user.id),
        callSiteLabel: "forget-subject audit",
        callerFeature: CRYPTO_SHREDDING_FEATURE_NAME,
      },
      {
        aggregateId,
        aggregateType: CRYPTO_SHREDDING_AGGREGATE_TYPE,
        type: SUBJECT_FORGOTTEN_EVENT_NAME,
        payload,
      },
    );
  }
}

// Manual crypto-shred for a DPO / platform operator: erases the subject's
// DEK immediately (all its PII ciphertext becomes unreadable, reads render
// "[[erased]]") and appends the audit event. Forget is final — the adapter
// keeps a tombstone, so the subject can never get a new key.
//
// The automated Art.-17 path (user-data-rights forget-cleanup) calls
// kms.eraseKey directly inside its per-user sub-tx; this command is the
// standalone trigger for cases outside that pipeline (authority requests,
// tenant-destroy in Sprint 5, operator recovery).
export const forgetSubjectWrite = defineWriteHandler({
  name: "forget-subject",
  schema: forgetSubjectSchema,
  access: { roles: [ROLES.DataProtectionOfficer, ROLES.SystemAdmin] },
  description:
    "Irreversibly crypto-shreds one user, tenant or record subject by erasing its encryption key, nulling its blind indexes, purging its search documents and closing the user's login, for supervisory-authority requests and operator recovery outside the automated Art. 17 cleanup pipeline.",
  // Erasing the subject key is irreversible: there is no undo, so an agent must
  // not be able to reach it at all.
  agent: { expose: false, risk: "high" },
  escapeHatch: {
    grants: ["unsafeRaw"],
    reason:
      "the denial and SUBJECT_FORGOTTEN audit appends name the caller's own tenant stream on the outside-transaction db; " +
      "the tenant-scope and retention checks run against the subject's tenant, not necessarily the caller's; " +
      "the blind-index sweep and search purge address the subject across tenants; the user " +
      "lifecycle update and PAT revoke run on the SYSTEM user stream.",
  },
  handler: async (event, ctx) => {
    assertIrreversibleOperationAllowed("forget-subject key erase");
    const kms = configuredPiiSubjectKms();
    if (!kms) {
      return writeFailure(
        new InternalError({
          message:
            "[crypto-shredding] forget-subject called but no KMS adapter is configured — " +
            "pass runProdApp({ kms }) / configurePiiSubjectKms(adapter) at boot.",
        }),
      );
    }

    const raw = event.payload.subject;
    const subject: SubjectId =
      raw.kind === "user"
        ? { kind: "user", userId: raw.userId }
        : raw.kind === "tenant"
          ? { kind: "tenant", tenantId: raw.tenantId }
          : { kind: "record", entity: raw.entity, id: raw.id };
    const subjectKey = subjectIdToKey(subject);

    const tenantScopeDenial = await resolveTenantScopeDenial(
      ctx.db.unsafeRaw(),
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
        ctx.dbOutsideTransaction?.unsafeRaw(),
      );
      return auditFailure ?? tenantScopeDenial;
    }

    // Runs after the tenant gate but before any key is touched: a retention
    // check ahead of the tenant gate would leak a foreign entity's retention
    // posture to a cross-tenant prober.
    const retentionDenial = await resolveRetentionDenial(ctx, raw, () => ctx.db.unsafeRaw());
    if (retentionDenial) {
      const auditFailure = await appendDenialAuditEvent(
        ctx,
        event,
        subjectKey,
        raw.kind,
        TARGET_RECORD_RETENTION_BLOCK_DELETE,
        ctx.dbOutsideTransaction?.unsafeRaw(),
      );
      return auditFailure ?? retentionDenial;
    }

    // Erase BEFORE the audit append: if the append throws, the key is gone
    // but no event exists — a retry is a no-op erase plus the event. The
    // reverse order could leave an audit trail claiming a shred that never
    // happened.
    await kms.eraseKey(subject, {
      requestId: requestContext.get()?.requestId ?? "crypto-shredding:forget-subject",
      userId: event.user.id,
      eraseReason: event.payload.reason,
    });

    const cleanupError = await sweepDerivedSubjectData(
      ctx,
      subject,
      subjectKey,
      ctx.db.unsafeRaw(),
    );

    // User subject: close the login door. DEK-erase makes the passwordHash
    // ciphertext unreadable, but status + PATs are standalone credentials —
    // the PAT resolver only checks revokedAt/expiresAt, NOT user.status
    // (resolver.ts). Without this block a forgotten user with a live PAT stays
    // callable. Mirror of the automated Art.-17 path (userDeleteHook:
    // status=Deleted; apiTokenDeleteHook: revoke):
    //   - user.updated as lifecycle event (updateUserLifecycle), so a
    //     read_users rebuild doesn't wipe the flip (#494)
    //   - sessions don't need active revocation — session-callbacks
    //     re-validate user.status on every request (isPrincipalBlocked
    //     blocks Deleted).
    // Both idempotent (status set / revokedAt IS NULL filter), retry after
    // crash recovery is safe. User-feature guard: without the user feature
    // read_users doesn't exist (crypto-only stack). Tenant subjects have no
    // credentials.
    if (raw.kind === "user" && ctx.registry.features.has("user")) {
      await closeUserLoginDoorBestEffort(ctx, raw.userId, ctx.db.unsafeRaw());
    }

    await appendSubjectForgotten(
      ctx,
      event,
      subjectAggregateId(raw),
      {
        subjectKey,
        reason: event.payload.reason,
        forgottenBy: event.user.id,
        ...(cleanupError !== undefined && { cleanupError }),
      },
      ctx.dbOutsideTransaction?.unsafeRaw(),
    );

    if (cleanupError !== undefined) {
      throw new InternalError({
        message: `[crypto-shredding] forget-subject erased the key but a derived-data sweep failed (${cleanupError}); retry to finish the cleanup.`,
      });
    }

    return { isSuccess: true as const, data: { subjectKey } };
  },
});
