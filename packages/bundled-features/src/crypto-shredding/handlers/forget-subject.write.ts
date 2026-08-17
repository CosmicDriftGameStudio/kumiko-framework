import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import {
  configuredPiiSubjectKms,
  type SubjectId,
  subjectIdToKey,
} from "@cosmicdrift/kumiko-framework/crypto";
import { nullBlindIndexesForSubject } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { purgeSearchDocumentsForSubject } from "@cosmicdrift/kumiko-framework/search";
import { z } from "zod";
import { revokeAllPatTokensForUser } from "../../personal-access-tokens/revoke-for-user";
import { USER_STATUS } from "../../user";
import { updateUserLifecycle } from "../../user-data-rights";
import { CRYPTO_SHREDDING_AGGREGATE_TYPE, SUBJECT_FORGOTTEN_EVENT_NAME } from "../constants";

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
    if (raw.kind === "user" && ctx.registry.features.has("user")) {
      await updateUserLifecycle(ctx.db.raw, raw.userId, { status: USER_STATUS.Deleted });
      if (ctx.registry.features.has("personal-access-tokens")) {
        await revokeAllPatTokensForUser(ctx.db.raw, raw.userId);
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
