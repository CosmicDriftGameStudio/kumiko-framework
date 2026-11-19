import {
  findKmsModeProblem,
  type KmsAdapter,
  type KmsMode,
  resolveKmsWiringAsync,
} from "@cosmicdrift/kumiko-framework/crypto";

export type { KmsMode };

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
  const problem = findKmsModeProblem(kmsMode);
  if (problem !== undefined) throw new Error(`[runProdApp] ${problem}.`);
  if (typeof kmsMode === "object") {
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
