// Boot-time env validation for the subject-keys KMS, shared by every app that
// mounts crypto-shredding. Lived copy-pasted in four apps before fw#1617; the
// copies drifted apart in their parsers, which is the failure mode this module
// exists to end.
//
// Split in two on purpose: `buildPgKmsOptions` is pure and unit-testable
// (the rotation slot mapping is the part that silently corrupts data when it
// is wrong), `resolveKmsWiring` is the boot entry point that also constructs
// the adapter.

import { createPgKmsAdapter, type PgKmsAdapter, type PgKmsAdapterOptions } from "./pg-kms-adapter";

// The index signature is what lets callers pass `process.env` directly. Without
// it every member is optional, so TypeScript's weak-type detection rejects
// ProcessEnv for having "no properties in common" — and each app would need
// either a hand-written six-key mapping or a cast. An env map genuinely does
// carry arbitrary keys, so the signature states a fact rather than loosening
// the type for convenience.
export type KmsWiringEnv = {
  readonly PLATFORM_KEK?: string | undefined;
  readonly SUBJECT_KEYS_DATABASE_URL?: string | undefined;
  readonly KUMIKO_BLIND_INDEX_KEY?: string | undefined;
  readonly PLATFORM_KEK_VERSION?: string | undefined;
  readonly PLATFORM_KEK_PREVIOUS?: string | undefined;
  readonly PLATFORM_KEK_PREVIOUS_VERSION?: string | undefined;
  readonly [key: string]: string | undefined;
};

/** Narrowed form for `buildPgKmsOptions` — presence of the two required
 *  members is the caller's job (`resolveKmsWiring` does it via the trio check). */
export type PgKmsRotationEnv = KmsWiringEnv & {
  readonly PLATFORM_KEK: string;
  readonly SUBJECT_KEYS_DATABASE_URL: string;
};

export type ActiveKmsWiring = {
  readonly kms: PgKmsAdapter;
  readonly blindIndexKey: string;
};

/** Plaintext fallback carries its reason so the boot log says WHY PII is
 *  unencrypted — an app running like this by accident is a reportable breach. */
export type PlaintextPiiWiring = { readonly allowPlaintextPii: string };

export type KmsWiring = ActiveKmsWiring | PlaintextPiiWiring;

export type KmsWiringOptions = {
  /** Prefixes the all-or-none error. Use the app's existing boot-log prefix —
   *  people grep for it in production logs. */
  readonly logPrefix?: string;
  /** Reason recorded when the trio is absent and plaintext PII is accepted. */
  readonly plaintextReason?: string;
};

const DEFAULT_PLAINTEXT_REASON = "local dev without subject-keys KMS (fw#818)";

// Number(raw) + Number.isInteger is the wrong parser for an env string:
// Number.isInteger(1e21) is true, so "1e21" passes, and the value then
// stringifies back to "1e+21" as a previousKeks object key — a lookup against
// the integer kek_version column never hits that slot, silently leaving
// rotation-window rows unreadable. Same class: "0x10" -> 16, " 2 " trimmed,
// "-1"/"0" accepted as versions, values past MAX_SAFE_INTEGER rounded.
// A digits-only regex closes all of these at once (phronexsis#323).
function parseKekVersion(raw: string, fieldName: string): number {
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`${fieldName} must be a positive integer, got "${raw}".`);
  }
  const version = Number(raw);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error(`${fieldName} must be a positive integer, got "${raw}".`);
  }
  return version;
}

/** Maps the KEK env vars onto adapter options, including which version slot an
 *  old KEK lands in during a rotation window.
 *
 *  Does NOT check that the previous version is older than the active one —
 *  `PgKmsAdapter`'s constructor already rejects `previousKeks[v] >= kekVersion`
 *  and stays the single source of that rule. */
export function buildPgKmsOptions(env: PgKmsRotationEnv): PgKmsAdapterOptions {
  const kekVersion = env.PLATFORM_KEK_VERSION
    ? parseKekVersion(env.PLATFORM_KEK_VERSION, "PLATFORM_KEK_VERSION")
    : 1;
  if (!env.PLATFORM_KEK_PREVIOUS) {
    if (env.PLATFORM_KEK_PREVIOUS_VERSION) {
      throw new Error(
        "PLATFORM_KEK_PREVIOUS must be set when PLATFORM_KEK_PREVIOUS_VERSION is set.",
      );
    }
    return {
      databaseUrl: env.SUBJECT_KEYS_DATABASE_URL,
      platformKek: env.PLATFORM_KEK,
      kekVersion,
    };
  }
  if (!env.PLATFORM_KEK_PREVIOUS_VERSION) {
    throw new Error("PLATFORM_KEK_PREVIOUS_VERSION must be set when PLATFORM_KEK_PREVIOUS is set.");
  }
  const previousVersion = parseKekVersion(
    env.PLATFORM_KEK_PREVIOUS_VERSION,
    "PLATFORM_KEK_PREVIOUS_VERSION",
  );
  return {
    databaseUrl: env.SUBJECT_KEYS_DATABASE_URL,
    platformKek: env.PLATFORM_KEK,
    kekVersion,
    previousKeks: { [previousVersion]: env.PLATFORM_KEK_PREVIOUS },
  };
}

function assertTrioConsistent(env: KmsWiringEnv, logPrefix: string | undefined): boolean {
  const trio = [env.PLATFORM_KEK, env.SUBJECT_KEYS_DATABASE_URL, env.KUMIKO_BLIND_INDEX_KEY];
  const complete = trio.every(Boolean);
  if (!complete && trio.some(Boolean)) {
    throw new Error(
      `${logPrefix ? `${logPrefix} ` : ""}PLATFORM_KEK / SUBJECT_KEYS_DATABASE_URL / ` +
        "KUMIKO_BLIND_INDEX_KEY are all-or-none — a partial set means the KMS wiring is broken.",
    );
  }
  if (Boolean(env.PLATFORM_KEK_PREVIOUS) !== Boolean(env.PLATFORM_KEK_PREVIOUS_VERSION)) {
    throw new Error(
      `${logPrefix ? `${logPrefix} ` : ""}PLATFORM_KEK_PREVIOUS and ` +
        "PLATFORM_KEK_PREVIOUS_VERSION must be set together " +
        "(KEK rotation, runbook kek-rotation.md).",
    );
  }
  if (!complete && (env.PLATFORM_KEK_PREVIOUS || env.PLATFORM_KEK_PREVIOUS_VERSION)) {
    throw new Error(
      `${logPrefix ? `${logPrefix} ` : ""}PLATFORM_KEK / SUBJECT_KEYS_DATABASE_URL / ` +
        "KUMIKO_BLIND_INDEX_KEY are all-or-none — rotation settings require the complete KMS wiring.",
    );
  }
  return complete;
}

/** Boot wiring for apps that may run without a KMS (dev, local): complete trio
 *  yields the adapter, empty trio yields the plaintext fallback, partial throws.
 *
 *  Prod entry points that must never fall back: use `requireKmsWiring`. */
export function resolveKmsWiring(env: KmsWiringEnv, options: KmsWiringOptions = {}): KmsWiring {
  const complete = assertTrioConsistent(env, options.logPrefix);
  if (complete && env.PLATFORM_KEK && env.SUBJECT_KEYS_DATABASE_URL && env.KUMIKO_BLIND_INDEX_KEY) {
    return {
      kms: createPgKmsAdapter(
        buildPgKmsOptions({
          ...env,
          PLATFORM_KEK: env.PLATFORM_KEK,
          SUBJECT_KEYS_DATABASE_URL: env.SUBJECT_KEYS_DATABASE_URL,
        }),
      ),
      blindIndexKey: env.KUMIKO_BLIND_INDEX_KEY,
    };
  }
  return { allowPlaintextPii: options.plaintextReason ?? DEFAULT_PLAINTEXT_REASON };
}

/** Same as `resolveKmsWiring` but the trio is mandatory — an absent trio throws
 *  instead of silently accepting plaintext PII. Separate function rather than a
 *  flag so the return type is the active wiring, with no narrowing at the call
 *  site. */
export function requireKmsWiring(
  env: KmsWiringEnv,
  options: KmsWiringOptions = {},
): ActiveKmsWiring {
  const wiring = resolveKmsWiring(env, options);
  if ("allowPlaintextPii" in wiring) {
    throw new Error(
      `${options.logPrefix ? `${options.logPrefix} ` : ""}PLATFORM_KEK / ` +
        "SUBJECT_KEYS_DATABASE_URL / KUMIKO_BLIND_INDEX_KEY are required here — " +
        "no plaintext-PII opt-out on this entry point.",
    );
  }
  return wiring;
}
