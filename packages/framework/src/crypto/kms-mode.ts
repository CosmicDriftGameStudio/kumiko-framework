// Runtime imports only from import-free modules: defineAppConfig loads this, and tooling reads
// kumiko.config.ts without the engine runtime.
import { reasonProblem } from "../engine/escape-hatch-reason.ts";

const KMS_MODE_NAMES = ["required", "optional"] as const;

function isKmsModeName(value: unknown): value is (typeof KMS_MODE_NAMES)[number] {
  return KMS_MODE_NAMES.some((name) => name === value);
}

/** Short form over the low-level `kms` / `blindIndexKey` / `allowPlaintextPii`
 *  fields:
 *  - `"required"`: wires the subject-key KMS from `PLATFORM_KEK`,
 *    `SUBJECT_KEYS_DATABASE_URL` and `KUMIKO_BLIND_INDEX_KEY` (ciphertext
 *    slots resolved via the Key Manager); an empty trio aborts the boot.
 *  - `"optional"`: wires it when the trio is complete. An empty trio leaves the
 *    app without KMS and the PII boot gate decides: PII carriers abort.
 *  - `{ plaintextReason }`: no KMS, PII stays plaintext; the reason is logged
 *    for the audit trail. Use only for demo apps.
 *
 *  A partial trio throws in every mode. */
export type KmsMode = (typeof KMS_MODE_NAMES)[number] | { readonly plaintextReason: string };

/** The problem with a kmsMode value read from untyped config, or undefined when it is valid. */
export function findKmsModeProblem(kmsMode: unknown): string | undefined {
  if (isKmsModeName(kmsMode)) return undefined;
  if (typeof kmsMode === "object" && kmsMode !== null && !Array.isArray(kmsMode)) {
    const reason = "plaintextReason" in kmsMode ? kmsMode.plaintextReason : undefined;
    if (typeof reason !== "string") {
      return "kmsMode.plaintextReason must name a reason as a string";
    }
    const problem = reasonProblem(reason);
    return problem === undefined
      ? undefined
      : `kmsMode.plaintextReason must name a reason (${problem})`;
  }
  return `kmsMode must be one of ${KMS_MODE_NAMES.join(", ")} or { plaintextReason }, got ${describeKmsModeValue(kmsMode)}`;
}

function describeKmsModeValue(value: unknown): string {
  return Array.isArray(value) ? "an array" : String(value);
}
