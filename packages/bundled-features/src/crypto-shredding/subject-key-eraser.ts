import { configuredPiiSubjectKms } from "@cosmicdrift/kumiko-framework/crypto";
import { defineMspApply } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { subjectIdFromKey } from "@cosmicdrift/kumiko-types/kms-adapter-types";
import { subjectForgottenSchema } from "./handlers/forget-subject.write.ts";

// Runs after the forget's transaction committed, so a rolled-back forget never loses its key.
// Strict error mode: a KMS outage retries and then parks the consumer as dead instead of skipping.
export const eraseForgottenSubjectKey = defineMspApply(async (event) => {
  const kms = configuredPiiSubjectKms();
  if (!kms) {
    throw new InternalError({
      message:
        "[crypto-shredding] subject-key-eraser has no KMS adapter configured — pass runProdApp({ kms }) / configurePiiSubjectKms(adapter) at boot.",
    });
  }
  // parse: events written before cleanupError was dropped still carry it; zod strips it.
  const payload = subjectForgottenSchema.parse(event.payload);
  await kms.eraseKey(subjectIdFromKey(payload.subjectKey), {
    requestId: `crypto-shredding:subject-key-eraser:${event.id}`,
    userId: payload.forgottenBy,
    eraseReason: payload.reason,
  });
});
