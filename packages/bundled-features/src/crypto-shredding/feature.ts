import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { CRYPTO_SHREDDING_FEATURE_NAME } from "./constants.js";
import {
  forgetSubjectWrite,
  subjectForgetDeniedSchema,
  subjectForgottenSchema,
} from "./handlers/forget-subject.write.js";

export function createCryptoShreddingFeature(): FeatureDefinition {
  return defineFeature(
    CRYPTO_SHREDDING_FEATURE_NAME,
    (r) => {
      r.describe(
        "Operator-level crypto-shredding trigger. `forget-subject` erases a user or tenant subject key in the configured KMS adapter, making every PII field encrypted under it permanently unreadable (reads render the `[[erased]]` sentinel), and appends a `subject-forgotten` audit event. Requires a KMS adapter (`runProdApp({ kms })`). The automated Art.-17 deletion pipeline in `user-data-rights` erases keys itself; this command covers manual forgets (authority requests, operator recovery, tenant destroy).",
      );
      r.uiHints({
        displayLabel: "Crypto-Shredding",
        category: "compliance",
      });

      // `reason` is operator free text and may name the subject, yet stays plaintext: the forget
      // erases the subject key before the audit append, so a forget of the actor's own tenant
      // would fail to seal the reason under that tenant's key.
      r.defineEvent("subject-forgotten", subjectForgottenSchema, { piiFields: "none" });
      r.defineEvent("forget-denied", subjectForgetDeniedSchema, { piiFields: "none" });
      r.writeHandler(forgetSubjectWrite);
    },
    { dedupeOptions: {} },
  );
}
