import { createHash } from "node:crypto";
import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import {
  configuredPiiSubjectKms,
  type SubjectId,
  subjectIdToKey,
} from "@cosmicdrift/kumiko-framework/crypto";
import {
  type DbRunner,
  nullBlindIndexesForSubject,
  subjectRowExistsInTenant,
} from "@cosmicdrift/kumiko-framework/db";
import {
  defineWriteHandler,
  type FeatureDefinition,
  type SessionUser,
  type TenantId,
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
  SUBJECT_FORGET_DENIED_EVENT_NAME,
  SUBJECT_FORGOTTEN_EVENT_NAME,
  TARGET_TENANT_NOT_ADMIN_TENANT,
} from "../constants";

export const subjectIdSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: z.uuid() }),
  z.object({ kind: z.literal("tenant"), tenantId: z.uuid() }),
]);

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
  subjectKind: z.enum(["user", "tenant"]),
  reason: z.string().min(10),
  forgottenBy: z.string().min(1),
  actorTenantId: z.string().min(1),
  denial: z.string().min(1),
});

type SubjectIdInput = z.infer<typeof subjectIdSchema>;

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
        : { kind: "tenant", tenantId: raw.tenantId as TenantId }; // @cast-boundary uuid-validated command payload → branded id
    const subjectKey = subjectIdToKey(subject);

    const tenantScopeDenial = await resolveTenantScopeDenial(
      ctx.db.raw,
      ctx.registry.features,
      event.user,
      raw,
    );
    if (tenantScopeDenial) {
      // Denied cross-tenant probes must still leave an audit trail (fw#2348),
      // but the denial lands in the REQUESTING actor's own tenant-scoped
      // stream — it must never materialise the foreign subject's identifiers
      // there. A plaintext subjectKey/aggregateId would survive as a
      // permanent record for the prober and would still be present when the
      // owning tenant later runs its own (legitimate) forget-subject for that
      // subject. The digest still lets an operator correlate repeated probes
      // of the same subject without exposing it (fw#2452).
      //
      // Appended outside the handler tx (fw#2592): `return tenantScopeDenial`
      // below rolls that tx back, and this event is the only proof the denial
      // happened. Skipping runProjectionsForEvent here is fine — nothing
      // projects crypto-shredding:event:forget-denied.
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
        subjectKeyDigest: createHash("sha256").update(subjectKey, "utf8").digest("base64url"),
        subjectKind: raw.kind,
        reason: event.payload.reason,
        forgottenBy: event.user.id,
        actorTenantId: event.user.tenantId,
        denial: tenantScopeDenial.error.code,
      });
      const reqCtx = requestContext.get();
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
      return tenantScopeDenial;
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
      aggregateId: raw.kind === "user" ? raw.userId : raw.tenantId,
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
