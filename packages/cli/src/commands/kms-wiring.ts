import type { KmsWiring } from "@cosmicdrift/kumiko-framework/crypto";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";

export const CLI_KMS_SLOTS = [
  "PLATFORM_KEK",
  "PLATFORM_KEK_PREVIOUS",
  "KUMIKO_BLIND_INDEX_KEY",
] as const;

// A rebuild replays applyEntityEvent, which computes bidx columns from the
// boot-injected blind-index key and subject KMS. This standalone CLI never
// boots the app, so without wiring them a rebuild nulls the bidx columns.
// Plaintext is refused for apps with PII carriers, like the prod boot does, unless
// the operator names a reason.
export async function wireKmsFromEnv(options: {
  readonly logPrefix: string;
  readonly log: (line: string) => void;
  readonly features: readonly FeatureDefinition[];
  readonly allowPlaintextPii?: string | undefined;
  /** What goes wrong without the wiring; completes the abort message. */
  readonly consequence?: string;
}): Promise<KmsWiring> {
  const crypto = await import("@cosmicdrift/kumiko-framework/crypto");
  const { assertPiiBootInvariants } = await import(
    "@cosmicdrift/kumiko-server-runtime/pii-boot-gate"
  );
  const wiring = await crypto.resolveKmsWiringAsync(process.env, {
    logPrefix: options.logPrefix,
    slots: CLI_KMS_SLOTS,
    log: options.log,
  });
  try {
    if ("kms" in wiring) {
      assertPiiBootInvariants(options.features, {
        mode: "prod",
        kms: wiring.kms,
        blindIndexKey: wiring.blindIndexKey,
      });
      crypto.configurePiiSubjectKms(wiring.kms);
      crypto.configureBlindIndexKey(wiring.blindIndexKey);
    } else {
      assertPiiBootInvariants(options.features, {
        mode: "prod",
        allowPlaintextPii: options.allowPlaintextPii,
      });
    }
  } catch (e) {
    await wiring.close();
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(
      `${options.logPrefix} ${reason} ${options.consequence ?? "The rebuild would null the blind-index columns."} Provide PLATFORM_KEK, SUBJECT_KEYS_DATABASE_URL and KUMIKO_BLIND_INDEX_KEY, or pass --allow-plaintext-pii <reason>.`,
    );
  }
  return wiring;
}
