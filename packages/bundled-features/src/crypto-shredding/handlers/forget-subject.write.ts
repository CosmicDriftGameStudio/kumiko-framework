import { createHash } from "node:crypto";
import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import {
  configuredPiiSubjectKms,
  type SubjectId,
  subjectIdSchema,
  subjectIdToKey,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  type DbRunner,
  nullBlindIndexesForSubject,
  recordRowExistsInTenant,
  subjectRowExistsInTenant,
} from "@cosmicdrift/kumiko-framework/db";
import {
  defineWriteHandler,
  type EntityDefinition,
  type FeatureDefinition,
  type HandlerContext,
  type SessionUser,
  type WriteEvent,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  InternalError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { append } from "@cosmicdrift/kumiko-framework/event-store";
import { purgeSearchDocumentsForSubject } from "@cosmicdrift/kumiko-framework/search";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { z } from "zod";
import { revokeAllPatTokensForUser } from "../../personal-access-tokens";
import { USER_STATUS } from "../../user";
import {
  denyIfTargetOutsideAdminTenant,
  isSystemAdminActor,
  updateUserLifecycle,
} from "../../user-data-rights";
import {
  CRYPTO_SHREDDING_AGGREGATE_TYPE,
  RECORD_ENTITY_NOT_REGISTERED,
  SUBJECT_FORGET_DENIED_EVENT_NAME,
  SUBJECT_FORGOTTEN_EVENT_NAME,
  TARGET_RECORD_NOT_ADMIN_TENANT,
  TARGET_RECORD_RETENTION_BLOCK_DELETE,
  TARGET_TENANT_NOT_ADMIN_TENANT,
} from "../constants";

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
  subjectKeyDigest: z.string().min(1),
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
    if (!entity) {
      return writeFailure(
        new AccessDeniedError({ details: { reason: RECORD_ENTITY_NOT_REGISTERED } }),
      );
    }
    const ownedInTenant = await recordRowExistsInTenant(
      db,
      features,
      raw.entity,
      raw.id,
      user.tenantId,
    );
    return ownedInTenant
      ? undefined
      : writeFailure(
          new AccessDeniedError({ details: { reason: TARGET_RECORD_NOT_ADMIN_TENANT } }),
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

// fw#2789: the host entity's OWN retention declaration gets the last word on
// a targeted row-shred — blockDelete (legally mandated physical retention,
// e.g. ledger/invoice text) means this command must refuse, not silently
// anonymize or proceed. Deliberately independent of the tenant feature/gate
// above: a retention obligation holds in single-tenant apps too, and running
// unconditionally (not nested under `features.has("tenant")`) keeps that
// true. Only the entity's declared `retention.strategy` is consulted here —
// NOT the data-retention feature's tenant-preset/override layering
// (resolveRetentionPolicy) — so a tenant cannot override its own way past a
// blockDelete declared on the entity.
function resolveRetentionDenial(
  features: ReadonlyMap<string, FeatureDefinition>,
  raw: SubjectIdInput,
): WriteFailure | undefined {
  if (raw.kind !== "record") return undefined;
  const entity = findRegisteredEntity(features, raw.entity);
  if (entity?.retention?.strategy !== "blockDelete") return undefined;
  return writeFailure(
    new AccessDeniedError({ details: { reason: TARGET_RECORD_RETENTION_BLOCK_DELETE } }),
  );
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
): Promise<WriteFailure | null> {
  const outsideTx = ctx.dbOutsideTransaction;
  if (!outsideTx) {
    return writeFailure(
      new InternalError({
        message:
          "[crypto-shredding] forget-subject denial audit event cannot be appended without " +
          "ctx.dbOutsideTransaction — dispatch wiring is missing the outside-tx db source.",
      }),
    );
  }
  const eventDef = ctx.registry.getEvent(SUBJECT_FORGET_DENIED_EVENT_NAME);
  if (!eventDef) {
    return writeFailure(
      new InternalError({
        message: `[crypto-shredding] event "${SUBJECT_FORGET_DENIED_EVENT_NAME}" is not registered.`,
      }),
    );
  }
  const payload = subjectForgetDeniedSchema.parse({
    // The denial lands in the REQUESTING actor's own tenant-scoped stream —
    // it must never materialise the foreign subject's identifiers there. A
    // plaintext subjectKey/aggregateId would survive as a permanent record
    // for the prober and would still be present when the owning tenant
    // later runs its own (legitimate) forget-subject for that subject. The
    // digest still lets an operator correlate repeated probes of the same
    // subject without exposing it (fw#2452).
    subjectKeyDigest: createHash("sha256").update(subjectKey, "utf8").digest("base64url"),
    subjectKind,
    reason: event.payload.reason,
    forgottenBy: event.user.id,
    actorTenantId: event.user.tenantId,
    denial: denialCode,
  });
  const reqCtx = requestContext.get();
  // This event is the only proof the denial happened. Skipping
  // runProjectionsForEvent here is fine — nothing projects
  // crypto-shredding:event:forget-denied.
  await append(outsideTx.raw, {
    aggregateId: generateId(),
    aggregateType: CRYPTO_SHREDDING_AGGREGATE_TYPE,
    // MUST be event.user.tenantId (the prober's own tenant), never
    // SYSTEM_TENANT_ID — .raw bypasses TenantDb's scoping wrapper, so this
    // is the only thing keeping the denial event out of the foreign
    // subject's tenant (fw#2452).
    tenantId: event.user.tenantId,
    expectedVersion: 0,
    type: SUBJECT_FORGET_DENIED_EVENT_NAME,
    eventVersion: eventDef.version,
    payload,
    metadata: {
      userId: event.user.id,
      ...(reqCtx?.requestId ? { requestId: reqCtx.requestId } : {}),
      ...(reqCtx?.correlationId ? { correlationId: reqCtx.correlationId } : {}),
      ...(reqCtx?.causationId ? { causationId: reqCtx.causationId } : {}),
    },
  });
  return null;
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
  agent: { expose: false },
  handler: async (event, ctx) => {
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
      ctx.db.raw,
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
        tenantScopeDenial.error.code,
      );
      return auditFailure ?? tenantScopeDenial;
    }

    // Runs AFTER the tenant gate (VORHER only means "before the shred"): a
    // retention check ahead of the tenant gate would leak a foreign
    // entity's retention posture to a cross-tenant prober.
    const retentionDenial = resolveRetentionDenial(ctx.registry.features, raw);
    if (retentionDenial) {
      // Own reason constant, not tenantScopeDenial's `.error.code` pattern:
      // AccessDeniedError.code is the generic "access_denied" for every
      // branch, so re-deriving it here would make a blockDelete refusal
      // indistinguishable from a cross-tenant one in the audit trail.
      const auditFailure = await appendDenialAuditEvent(
        ctx,
        event,
        subjectKey,
        raw.kind,
        TARGET_RECORD_RETENTION_BLOCK_DELETE,
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

    // Blind-index sweep (#818): null the erased subject's bidx columns now —
    // otherwise the deterministic HMAC stays equality-matchable until the next
    // rebuild. Deliberately ctx.db.raw: the ciphertext prefix addresses the
    // subject across tenants.
    await nullBlindIndexesForSubject(ctx.db.raw, ctx.registry.features, subjectKey);

    // Derived search index still holds plaintext (#1610) — purge next to the
    // blind-index sweep. No adapter → no-op (apps without search).
    if (ctx.searchAdapter) {
      await purgeSearchDocumentsForSubject(
        ctx.db.raw,
        ctx.registry.features,
        ctx.searchAdapter,
        subjectKey,
        subject,
      );
    }

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
    // Graceful fail: email-subscribers and other non-user entities may use
    // user-style subject keys without having an actual user row — the key
    // erase above is the important part for GDPR compliance; the lifecycle
    // update is best-effort for real users.
    if (raw.kind === "user" && ctx.registry.features.has("user")) {
      try {
        await updateUserLifecycle(ctx.db.raw, raw.userId, { status: USER_STATUS.Deleted });
        if (ctx.registry.features.has("personal-access-tokens")) {
          await revokeAllPatTokensForUser(ctx.db.raw, raw.userId);
        }
      } catch {
        // User row may not exist (e.g. email subscribers with user-style
        // subject keys). Key erase + blind-index sweep above already ran.
      }
    }

    await ctx.unsafeAppendEvent({
      aggregateId: subjectAggregateId(raw),
      aggregateType: CRYPTO_SHREDDING_AGGREGATE_TYPE,
      type: SUBJECT_FORGOTTEN_EVENT_NAME,
      payload: {
        subjectKey,
        reason: event.payload.reason,
        forgottenBy: event.user.id,
      },
    });

    return { isSuccess: true as const, data: { subjectKey } };
  },
});
