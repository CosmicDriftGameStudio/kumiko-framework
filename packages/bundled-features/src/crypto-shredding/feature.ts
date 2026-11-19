import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { featureWithEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import {
  CRYPTO_SHREDDING_FEATURE_NAME,
  SUBJECT_FORGOTTEN_EVENT_NAME,
  SUBJECT_KEY_ERASER_PROJECTION_NAME,
} from "./constants.ts";
import { kmsEnvSchema } from "./env/index.ts";
import {
  createForgetSubjectWrite,
  type ForgetSubjectOptions,
  subjectForgetDeniedSchema,
  subjectForgottenSchema,
} from "./handlers/forget-subject.write.ts";
import { eraseForgottenSubjectKey } from "./subject-key-eraser.ts";

export function createCryptoShreddingFeature(options: ForgetSubjectOptions = {}) {
  const feature = defineFeature(
    CRYPTO_SHREDDING_FEATURE_NAME,
    (r) => {
      r.describe(
        "Operator-level crypto-shredding trigger. `forget-subject` forgets the subject's rows of entities that declare `forgetWithSubject`, purges its search documents, files and blind indexes, closes a user's login and appends a `subject-forgotten` event in one transaction; the `subject-key-eraser` consumer then erases the subject key in the configured KMS adapter, making every PII field encrypted under it permanently unreadable (reads render the `[[erased]]` sentinel). Requires a KMS adapter (`runProdApp({ kms })`). The automated Art.-17 deletion pipeline in `user-data-rights` erases keys itself; this command covers manual forgets (authority requests, operator recovery, tenant destroy).",
      );
      r.uiHints({
        displayLabel: "Crypto-Shredding",
        category: "compliance",
      });
      r.envSchema(kmsEnvSchema);

      // `reason` is operator free text and stays plaintext: it is the audit record of an erasure and must stay readable after the key it would be sealed under (the actor's own tenant, on a tenant forget) is gone.
      r.defineEvent("subject-forgotten", subjectForgottenSchema, { piiFields: "none" });
      r.defineEvent("forget-denied", subjectForgetDeniedSchema, { piiFields: "none" });
      r.writeHandler(createForgetSubjectWrite(options));
      r.multiStreamProjection({
        name: SUBJECT_KEY_ERASER_PROJECTION_NAME,
        // No entry handler runs here; the erase is the committed outcome of a forget-subject (risk "high").
        irreversibleWithoutEntryHandler: "high-risk-or-cron-pipeline",
        apply: { [SUBJECT_FORGOTTEN_EVENT_NAME]: eraseForgottenSubjectKey },
      });
    },
    { dedupeOptions: { eraseOwnedRecordKeys: options.eraseOwnedRecordKeys === true } },
  );
  return featureWithEnvSchema(feature, kmsEnvSchema);
}
