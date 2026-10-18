import { type KmsAdapter, resolveKmsWiringAsync } from "@cosmicdrift/kumiko-framework/crypto";

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
export type KmsMode = "required" | "optional" | { readonly plaintextReason: string };

export type ResolvedKmsMode = {
  readonly kms?: KmsAdapter;
  readonly blindIndexKey?: string;
  readonly allowPlaintextPii?: string;
  readonly close: () => Promise<void>;
};

const KMS_CIPHERTEXT_SLOTS = ["PLATFORM_KEK", "PLATFORM_KEK_PREVIOUS", "KUMIKO_BLIND_INDEX_KEY"];

export type LowLevelKmsFields = {
  readonly kms?: KmsAdapter;
  readonly blindIndexKey?: string;
  readonly allowPlaintextPii?: string;
};

export async function resolveKmsMode(
  kmsMode: KmsMode | undefined,
  lowLevel: LowLevelKmsFields,
  envSource: Record<string, string | undefined>,
): Promise<ResolvedKmsMode> {
  const noop = (): Promise<void> => Promise.resolve();
  if (kmsMode === undefined) {
    return {
      ...(lowLevel.kms && { kms: lowLevel.kms }),
      ...(lowLevel.blindIndexKey !== undefined && { blindIndexKey: lowLevel.blindIndexKey }),
      ...(lowLevel.allowPlaintextPii !== undefined && {
        allowPlaintextPii: lowLevel.allowPlaintextPii,
      }),
      close: noop,
    };
  }
  if (
    lowLevel.kms !== undefined ||
    lowLevel.blindIndexKey !== undefined ||
    lowLevel.allowPlaintextPii !== undefined
  ) {
    throw new Error(
      "[runProdApp] kmsMode cannot be combined with kms / blindIndexKey / allowPlaintextPii — pick the short form or the low-level fields.",
    );
  }
  if (typeof kmsMode === "object") {
    if (kmsMode.plaintextReason.trim() === "") {
      throw new Error("[runProdApp] kmsMode.plaintextReason must name a reason.");
    }
    return { allowPlaintextPii: kmsMode.plaintextReason, close: noop };
  }
  const wiring = await resolveKmsWiringAsync(envSource, {
    slots: KMS_CIPHERTEXT_SLOTS,
    logPrefix: "[runProdApp]",
  });
  if ("kms" in wiring) {
    return { kms: wiring.kms, blindIndexKey: wiring.blindIndexKey, close: wiring.close };
  }
  if (kmsMode === "required") {
    throw new Error(
      '[runProdApp] kmsMode "required": PLATFORM_KEK / SUBJECT_KEYS_DATABASE_URL / KUMIKO_BLIND_INDEX_KEY are not set. ' +
        'Provision the KMS or use kmsMode: { plaintextReason: "…" }.',
    );
  }
  // The wiring's own plaintext fallback reason is deliberately dropped: only an
  // explicit plaintextReason may switch off the PII boot gate.
  return { close: noop };
}
