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
  // fw#2776: a declared event stance is worth as much as an entity annotation —
  // encryptEventPayloadPii no-ops without a KMS, so a catalogued event writes
  // plaintext PII into kumiko_events with nothing to crypto-shred later.
  const piiEvents = features.flatMap((feature) =>
    Object.values(feature.events ?? {})
      .filter((event) => event.piiFields !== undefined && event.piiFields !== "none")
      .map((event) => event.name),
  );
  // skip: nothing PII-annotated is mounted — plaintext gate is moot.
  if (piiEntities.length === 0 && piiEvents.length === 0) return;
  const carriers = [
    ...(piiEntities.length > 0 ? [`${piiEntities.length} entities`] : []),
    ...(piiEvents.length > 0 ? [`${piiEvents.length} events`] : []),
  ].join(" and ");
  const named = [
    ...(piiEntities.length > 0 ? [`entities [${piiEntities.join(", ")}]`] : []),
    ...(piiEvents.length > 0 ? [`events [${piiEvents.join(", ")}]`] : []),
  ].join(" and ");

  if (opts.mode === "dev") {
    // biome-ignore lint/suspicious/noConsole: boot-time security warning
    console.warn(
      `[${tag}] ${carriers} carry pii/userOwned/tenantOwned/recordOwned annotations or a non-"none" defineEvent PII stance but no \`kms\` adapter is configured — fields are stored in PLAINTEXT locally. Pass { kms: new InMemoryKmsAdapter() } (ephemeral DB) or createPgKmsAdapter(...) to exercise crypto-shredding in dev.`,
    );
    // skip: dev mode, plaintext-PII warning already logged above
    return;
  }
  if (opts.allowPlaintextPii) {
    // biome-ignore lint/suspicious/noConsole: boot-time security warning
    console.warn(
      `[${tag}] ${carriers} carry PII annotations but no \`kms\` adapter is configured — fields are stored in PLAINTEXT (allowPlaintextPii: "${opts.allowPlaintextPii}"). GDPR erasure via crypto-shredding is NOT possible until a KMS is provisioned.`,
    );
    // skip: operator explicitly acknowledged plaintext PII via allowPlaintextPii, warning already logged above
    return;
  }
  throw new Error(
    `[${tag}] BOOT ABORTED — ${named} carry pii/userOwned/tenantOwned/recordOwned annotations or a non-"none" defineEvent PII stance but no \`kms\` adapter is configured. The fields would be stored in PLAINTEXT and GDPR erasure (crypto-shredding) could not work. Pass runProdApp({ kms: createPgKmsAdapter({ databaseUrl, platformKek }) }) — or acknowledge explicitly with { allowPlaintextPii: "<reason>" } until your KMS is provisioned.`,
  );
}
