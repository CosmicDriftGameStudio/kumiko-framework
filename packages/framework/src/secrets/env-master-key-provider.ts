// Default MasterKeyProvider for deployments without a dedicated KMS. Reads
// KEK material from env, supports a multi-version keyring so rotation runs
// without a maintenance window. See loadKeyring + resolveCurrentVersion at
// the bottom for the env contract.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { InternalError } from "../errors";
import type { MasterKeyProvider } from "./types";

const ALGORITHM = "aes-256-gcm";
const KEK_LENGTH = 32; // AES-256
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export type EnvMasterKeyProviderOptions = {
  // Env accessor (injectable for tests). Defaults to process.env.
  readonly env?: Readonly<Record<string, string | undefined>>;
};

// A parsed keyring: version number → raw KEK bytes. Kept separate from
// the provider closure so loadKeyring is unit-testable in isolation.
export type Keyring = ReadonlyMap<number, Buffer>;

export function createEnvMasterKeyProvider(
  opts: EnvMasterKeyProviderOptions = {},
): MasterKeyProvider {
  const env = opts.env ?? process.env;

  const keyring = loadKeyring(env);
  const current = resolveCurrentVersion(env);

  // --- Boot validation (after keyring + current are known) -------------
  if (!keyring.has(current)) {
    throw new InternalError({
      message:
        `[secrets] currentVersion=${current} not present in keyring ` +
        `(have versions: ${[...keyring.keys()].sort().join(",")}). ` +
        `Check KUMIKO_SECRETS_MASTER_KEY_V${current} is set.`,
    });
  }

  // --- KEK-wrap / unwrap boilerplate (AES-256-GCM) ---------------------
  // The DEK is the plaintext here; we encrypt it with the KEK. Same
  // algorithm as the value encryption, just a different role.

  return {
    async wrapDek(dek) {
      const kek = keyring.get(current);
      if (!kek) {
        // Should never reach here — boot validation above guarantees the
        // current KEK exists. Defensive throw so a surprise at runtime is
        // surfaceable instead of silently coercing to zero-bytes.
        throw new InternalError({
          message: `[secrets] missing KEK for current version ${current}`,
        });
      }
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, kek, iv);
      const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
      const tag = cipher.getAuthTag();
      // Pack into a single buffer: iv || tag || ciphertext. The kekVersion
      // is returned separately — it lives on the Envelope row, not inside
      // encryptedDek, so ops can inspect it with `SELECT kekVersion FROM …`.
      return {
        encryptedDek: Buffer.concat([iv, tag, wrapped]),
        kekVersion: current,
      };
    },

    async unwrapDek(encryptedDek, kekVersion) {
      const kek = keyring.get(kekVersion);
      if (!kek) {
        throw new InternalError({
          message:
            `[secrets] no KEK for version ${kekVersion} — ` +
            `keyring has [${[...keyring.keys()].sort().join(",")}]. ` +
            `If you retired an old version, you must rotate rows off it first.`,
        });
      }
      const iv = encryptedDek.subarray(0, IV_LENGTH);
      const tag = encryptedDek.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const ciphertext = encryptedDek.subarray(IV_LENGTH + TAG_LENGTH);
      const decipher = createDecipheriv(ALGORITHM, kek, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    },

    currentVersion() {
      return current;
    },

    async isAvailable() {
      // Env-backed provider is always "available" once boot passed — the
      // check already verified keyring presence. Real KMS providers would
      // ping the service here.
      return true;
    },
  };
}

// ENV schema (Decision 1 — per-version variables):
//   KUMIKO_SECRETS_MASTER_KEY_V1=<base64 32 bytes>
//   KUMIKO_SECRETS_MASTER_KEY_V2=<base64 32 bytes>
//   ...
// Rationale: k8s secrets map 1:1 per env var, so ops rotate single versions
// without rewriting a JSON blob. A typo blasts only one key, not the ring.
const KEY_VAR_PATTERN = /^KUMIKO_SECRETS_MASTER_KEY_V(\d+)$/;

function loadKeyring(env: Readonly<Record<string, string | undefined>>): Keyring {
  const keyring = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(env)) {
    const match = name.match(KEY_VAR_PATTERN);
    if (!match || !value) continue;
    // biome-ignore lint/style/noNonNullAssertion: regex group 1 always present
    const version = Number.parseInt(match[1]!, 10);
    if (!Number.isFinite(version) || version < 1) {
      throw new InternalError({
        message: `[secrets] invalid KEK version in ${name} (must be positive integer)`,
      });
    }
    const kek = Buffer.from(value, "base64");
    if (kek.length !== KEK_LENGTH) {
      throw new InternalError({
        message: `[secrets] ${name}: KEK must decode to exactly ${KEK_LENGTH} bytes (got ${kek.length})`,
      });
    }
    keyring.set(version, kek);
  }
  if (keyring.size === 0) {
    throw new InternalError({
      message: "[secrets] no KEK found in environment — set at least KUMIKO_SECRETS_MASTER_KEY_V1",
    });
  }
  return keyring;
}

// currentVersion resolution (Decision 2 — explicit env var):
//   KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION=2
// Rationale: adding a new KEK to the keyring must NOT auto-promote it to
// "wrap with this one". Staging window — ops deploys V2 alongside V1, runs
// a canary rotation job, then flips CURRENT_VERSION only after validation.
// AWS KMS, GCP KMS, Azure Key Vault all separate "known-keys" from
// "active-key-id" for the same reason.
const CURRENT_VERSION_VAR = "KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION";

function resolveCurrentVersion(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env[CURRENT_VERSION_VAR];
  if (!raw) {
    throw new InternalError({
      message:
        `[secrets] ${CURRENT_VERSION_VAR} not set — explicit current-version ` +
        "required so adding a new KEK to the env doesn't auto-promote it",
    });
  }
  const version = Number.parseInt(raw, 10);
  if (!Number.isFinite(version) || version < 1 || String(version) !== raw.trim()) {
    throw new InternalError({
      message: `[secrets] ${CURRENT_VERSION_VAR}="${raw}" must be a positive integer`,
    });
  }
  return version;
}
