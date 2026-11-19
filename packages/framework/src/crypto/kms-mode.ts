// No runtime imports: defineAppConfig loads this, and tooling reads kumiko.config.ts without the engine runtime.

const KMS_MODE_NAMES = ["required", "optional"] as const;

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
export function findKmsModeProblem(kmsMode: KmsMode): string | undefined {
  if (typeof kmsMode === "object") {
    return kmsMode.plaintextReason.trim() === ""
      ? "kmsMode.plaintextReason must name a reason"
      : undefined;
  }
  return KMS_MODE_NAMES.includes(kmsMode)
    ? undefined
    : `kmsMode must be one of ${KMS_MODE_NAMES.join(", ")} or { plaintextReason }, got ${String(kmsMode)}`;
}
