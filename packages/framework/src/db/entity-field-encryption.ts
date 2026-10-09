// Entity-field encryption (`encrypted: true` on text/longText fields),
// backed by the same envelope cipher as encrypted config values: JSON
// StoredEnvelope in the TEXT column, kekVersion per value, legacy
// single-key ciphertexts (pre-envelope ENCRYPTION_KEY era) readable via
// the cipher's legacy fallback until re-encrypted.

import { collectPiiSubjectFields } from "../crypto/index.js";
import type { EntityDefinition, TenantId } from "../engine/types/index.js";
import { createLogger, type Logger } from "../logging/index.js";
import { createEnvMasterKeyProvider } from "../secrets/env-master-key-provider.js";
import type { EnvelopeCipher } from "../secrets/envelope-cipher.js";
import type { KeyScope } from "../secrets/types.js";

export function collectEncryptedFieldNames(entity: EntityDefinition): ReadonlySet<string> {
  const names = new Set<string>();
  for (const [name, field] of Object.entries(entity.fields)) {
    if ((field.type === "text" || field.type === "longText") && field.encrypted === true) {
      names.add(name);
    }
  }
  return names;
}

// A field whose stored value is ciphertext, either always (encrypted) or
// depending on runtime KMS wiring (PII) — either way it has no plaintext
// column to compare against directly.
export function isSensitiveLabelField(entity: EntityDefinition, field: string): boolean {
  return (
    collectEncryptedFieldNames(entity).has(field) || collectPiiSubjectFields(entity).includes(field)
  );
}

// `searchable: true` on a text field means it is indexed plaintext
// somewhere findable by term — a plain text field's own column, or (for a
// personal-data field) the derived search index mirroring it.
export function hasSearchablePlaintext(entity: EntityDefinition, field: string): boolean {
  const def = entity.fields[field];
  return def?.type === "text" && def.searchable === true;
}

// BYOK hook: thread the row's tenant to the cipher when the row carries one
// (system-scope rows may not).
function scopeOf(row: Record<string, unknown>): KeyScope | undefined {
  const tenantId = row["tenantId"];
  return typeof tenantId === "string" ? { tenantId: tenantId as TenantId } : undefined; // @cast-boundary db-row
}

async function encryptFieldValue(
  fieldName: string,
  value: unknown,
  cipher: EnvelopeCipher,
  scope: KeyScope | undefined,
): Promise<string> {
  if (value === null || value === undefined) {
    throw new Error(`encrypted field "${fieldName}" cannot be null or undefined`);
  }
  if (typeof value !== "string") {
    throw new Error(`encrypted field "${fieldName}" must be a string, got ${typeof value}`);
  }
  return cipher.encrypt(value, scope);
}

export async function encryptEntityFieldValues(
  row: Record<string, unknown>,
  encryptedFields: ReadonlySet<string>,
  cipher: EnvelopeCipher,
  opts?: { onlyKeys?: Iterable<string> },
): Promise<Record<string, unknown>> {
  if (encryptedFields.size === 0) return row;
  const only = opts?.onlyKeys ? new Set(opts.onlyKeys) : null;
  const out = { ...row };
  const scope = scopeOf(row);
  for (const name of encryptedFields) {
    if (only && !only.has(name)) continue;
    if (!(name in out)) continue;
    const value = out[name];
    if (value === null || value === undefined) continue;
    out[name] = await encryptFieldValue(name, value, cipher, scope);
  }
  return out;
}

let undecryptableFieldLogger: Logger | undefined;

function defaultUndecryptableFieldLogger(): Logger {
  undecryptableFieldLogger ??= createLogger();
  return undecryptableFieldLogger;
}

// Logs identifiers and the error class only: ciphertext, key material and the
// cipher's error message (which may echo envelope content) never reach the log.
export function logUndecryptableField(
  info: { entityName: string | undefined; rowId: unknown; field: string; error: unknown },
  logger: Logger = defaultUndecryptableFieldLogger(),
): void {
  logger.error("encrypted field could not be decrypted; returned as null", {
    entity: info.entityName,
    rowId: info.rowId,
    field: info.field,
    errorName: info.error instanceof Error ? info.error.name : typeof info.error,
  });
}

// With `onFieldError` a field that fails to decrypt (wrong key, corrupt
// envelope) reads as null and is reported instead of throwing, so one bad row
// cannot fail a whole list. Without it decrypt stays fail-loud (write paths).
export async function decryptEntityFieldValues(
  row: Record<string, unknown>,
  encryptedFields: ReadonlySet<string>,
  cipher: EnvelopeCipher,
  opts?: { onFieldError?: (field: string, error: unknown) => void },
): Promise<Record<string, unknown>> {
  if (encryptedFields.size === 0) return row;
  const out = { ...row };
  const scope = scopeOf(row);
  for (const name of encryptedFields) {
    const value = out[name];
    if (value === null || value === undefined) continue;
    if (typeof value !== "string") continue;
    if (!opts?.onFieldError) {
      out[name] = await cipher.decrypt(value, scope);
      continue;
    }
    try {
      out[name] = await cipher.decrypt(value, scope);
    } catch (error) {
      out[name] = null;
      opts.onFieldError(name, error);
    }
  }
  return out;
}

// Boot-injected app-wide cipher. run{Prod,Dev}App (and test setups that
// exercise encrypted fields) call configureEntityFieldEncryption once with
// the same cipher instance the config feature uses; executors resolve it
// lazily so entities without encrypted fields never touch it.
let injectedCipher: EnvelopeCipher | undefined;

export function configureEntityFieldEncryption(cipher: EnvelopeCipher | undefined): void {
  injectedCipher = cipher;
}

export function resolveEntityFieldEncryption(): EnvelopeCipher {
  if (!injectedCipher) {
    throw new Error(
      "entity-field encryption is not configured — encrypted entity fields need a master key " +
        "(KUMIKO_SECRETS_MASTER_KEY_V<n>); run{Prod,Dev}App wire the cipher automatically, " +
        "custom boots call configureEntityFieldEncryption(cipher).",
    );
  }
  return injectedCipher;
}

// Non-throwing probe for callers that degrade gracefully (DSGVO export
// replaces encrypted fields with an explicit marker instead of failing
// the whole export when no cipher is wired).
export function configuredEntityFieldEncryption(): EnvelopeCipher | undefined {
  return injectedCipher;
}

/** @internal test-only */
export function resetEntityFieldEncryptionCacheForTests(): void {
  injectedCipher = undefined;
}

// Boot-time availability probe for validateBoot: either a cipher was
// injected, or the env keyring must be constructible — eager construction
// surfaces missing AND malformed keys (wrong length, bad base64) at boot
// instead of on the first encrypted read in prod. validateBoot runs before
// configureEntityFieldEncryption, so the env probe is the common path.
export function validateEntityFieldEncryptionAvailable(
  env: Readonly<Record<string, string | undefined>> = process.env,
  bootCipher?: EnvelopeCipher,
): void {
  // skip: an injected cipher (test seam / custom KMS) or the runner's boot cipher satisfies availability
  if (bootCipher ?? injectedCipher) return;
  try {
    createEnvMasterKeyProvider({
      env: {
        ...env,
        KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION:
          env["KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION"] ?? "1",
      },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `encrypted entity fields in use but no usable master key (${reason}) — set ` +
        "KUMIKO_SECRETS_MASTER_KEY_V1 (32 bytes, base64) or pass `masterKey` to " +
        "runProdApp/runWorkerApp (or inject a cipher via configureEntityFieldEncryption()).",
    );
  }
}
