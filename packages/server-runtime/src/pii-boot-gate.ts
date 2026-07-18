import {
  collectLookupableFields,
  collectPiiSubjectFields,
  type KmsAdapter,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";

type PiiGateOptions = {
  readonly kms?: KmsAdapter | undefined;
  readonly blindIndexKey?: string | undefined;
  readonly allowPlaintextPii?: string | undefined;
  /** prod fails hard on plaintext PII (opt-out via allowPlaintextPii);
   *  dev only warns — local data, and an InMemory KMS against a persistent
   *  dev DB would strand every row after a restart. */
  readonly mode: "prod" | "dev";
};

export function assertPiiBootInvariants(
  features: readonly FeatureDefinition[],
  opts: PiiGateOptions,
): void {
  const tag = opts.mode === "prod" ? "runProdApp" : "runDevApp";

  const lookupableEntities = features.flatMap((feature) =>
    Object.entries(feature.entities ?? {})
      .filter(([, entity]) => collectLookupableFields(entity).length > 0)
      .map(([name]) => name),
  );
  if (opts.kms && !opts.blindIndexKey && lookupableEntities.length > 0) {
    throw new Error(
      `[${tag}] BOOT ABORTED — entities [${lookupableEntities.join(", ")}] declare lookupable fields and a KMS is configured, but no blindIndexKey was passed. Equality lookups on encrypted fields would silently stop matching. Pass { blindIndexKey } (env: KUMIKO_BLIND_INDEX_KEY, generate: openssl rand -base64 32).`,
    );
  }

  // skip: KMS configured — PII fields are encrypted, nothing left to gate.
  if (opts.kms) return;
  const piiEntities = features.flatMap((feature) =>
    Object.entries(feature.entities ?? {})
      .filter(([, entity]) => collectPiiSubjectFields(entity).length > 0)
      .map(([name]) => name),
  );
  // skip: no PII-annotated entities mounted — plaintext gate is moot.
  if (piiEntities.length === 0) return;

  if (opts.mode === "dev") {
    // biome-ignore lint/suspicious/noConsole: boot-time security warning
    console.warn(
      `[${tag}] ${piiEntities.length} entities carry pii/userOwned/tenantOwned annotations but no \`kms\` adapter is configured — fields are stored in PLAINTEXT locally. Pass { kms: new InMemoryKmsAdapter() } (ephemeral DB) or createPgKmsAdapter(...) to exercise crypto-shredding in dev.`,
    );
    // skip: dev mode, plaintext-PII warning already logged above
    return;
  }
  if (opts.allowPlaintextPii) {
    // biome-ignore lint/suspicious/noConsole: boot-time security warning
    console.warn(
      `[${tag}] ${piiEntities.length} entities carry PII annotations but no \`kms\` adapter is configured — fields are stored in PLAINTEXT (allowPlaintextPii: "${opts.allowPlaintextPii}"). GDPR erasure via crypto-shredding is NOT possible until a KMS is provisioned.`,
    );
    // skip: operator explicitly acknowledged plaintext PII via allowPlaintextPii, warning already logged above
    return;
  }
  throw new Error(
    `[${tag}] BOOT ABORTED — entities [${piiEntities.join(", ")}] carry pii/userOwned/tenantOwned annotations but no \`kms\` adapter is configured. The fields would be stored in PLAINTEXT and GDPR erasure (crypto-shredding) could not work. Pass runProdApp({ kms: createPgKmsAdapter({ databaseUrl, platformKek }) }) — or acknowledge explicitly with { allowPlaintextPii: "<reason>" } until your KMS is provisioned.`,
  );
}
