import { requestContext } from "@cosmicdrift/kumiko-framework/api";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import {
  configuredPiiSubjectKms,
  type SubjectId,
  subjectIdToKey,
} from "@cosmicdrift/kumiko-framework/crypto";
import { defineWriteHandler, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
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
