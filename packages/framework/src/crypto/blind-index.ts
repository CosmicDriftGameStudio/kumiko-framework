// Blind index for PII equality lookups.
// `lookupable: true` on a Subject-annotated text field generates a
// `<snake>_bidx` column containing a deterministic HMAC of the
// PLAINTEXT value. Equality queries match `(col = $1 OR col_bidx = $2)`
// and therefore work for both plaintext legacy rows and encrypted rows.
//
// Value format: kumiko-bidx:v1:<base64url(HMAC-SHA256(key, value))>
//
// HMAC computation is byte-exact and performs no normalization, preserving
// the existing case-sensitive equality semantics (lowercasing would change
// the behavior).
//
// The key is deliberately a SEPARATE 32-byte key (env:
// KUMIKO_BLIND_INDEX_KEY), not derived from PLATFORM_KEK and not part of the
// KmsAdapter contract, so BYOK adapters must never see it. Rotation requires
// recomputing all bidx columns.
//
// bidx values exist ONLY in the projection, never in event payloads: a
// deterministic HMAC in an immutable event would create permanent linkage
// and break erasure. applyEntityEvent computes them during Apply (live and
// rebuild); after key erasure, the rebuild recomputes them as NULL.

import { createHmac } from "node:crypto";
import { requestContext } from "../api/request-context.ts";
import type { EntityDefinition } from "../engine/types/fields.ts";
import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
} from "./pii-field-encryption.ts";

const BLIND_INDEX_PREFIX = "kumiko-bidx:v1:";
const BLIND_INDEX_KEY_LENGTH = 32;

export function computeBlindIndex(key: Uint8Array, plaintext: string): string {
  const mac = createHmac("sha256", key).update(plaintext, "utf8").digest("base64url");
  return `${BLIND_INDEX_PREFIX}${mac}`;
}

export function decodeBlindIndexKey(base64Key: string): Uint8Array {
  const decoded = Buffer.from(base64Key, "base64");
  if (decoded.length !== BLIND_INDEX_KEY_LENGTH) {
    throw new Error(
      `Blind-index key must be ${BLIND_INDEX_KEY_LENGTH} bytes base64-encoded, got ${decoded.length} bytes. ` +
        `Generate one: openssl rand -base64 32`,
    );
  }
  return decoded;
}

// Boot-injected app-wide key, mirroring configurePiiSubjectKms: run{Prod,Dev}App
// call configureBlindIndexKey once; query compilers + applyEntityEvent resolve
// lazily. Absent key = blind-indexing off (bidx columns stay NULL, equality
// lookups match plaintext rows only).
let injectedKey: Uint8Array | undefined;

export function configureBlindIndexKey(base64Key: string | undefined): void {
  injectedKey = base64Key === undefined ? undefined : decodeBlindIndexKey(base64Key);
}

export function configuredBlindIndexKey(): Uint8Array | undefined {
  return injectedKey;
}

/** @internal test-only */
export function resetBlindIndexKeyForTests(): void {
  injectedKey = undefined;
}

export function blindIndexFieldName(fieldName: string): string {
  return `${fieldName}Bidx`;
}

// The field names that carry a blind index — precomputed per apply like
// collectPiiSubjectFields. Only text fields qualify (boot-validated).
export function collectLookupableFields(entity: EntityDefinition): readonly string[] {
  return Object.entries(entity.fields)
    .filter(([, field]) => field.type === "text" && field.lookupable === true)
    .map(([name]) => name);
}

// bidx values for every lookupable field PRESENT in `values` (create payload
// or update changes — absent fields stay untouched). Ciphertext values are
// decrypted first so the HMAC always covers the plaintext; an erased subject
// (or the erased sentinel) yields NULL — the lookup stops matching, which is
// exactly the forget semantics.
export async function computeBlindIndexValues(
  values: Record<string, unknown>,
  lookupableFields: readonly string[],
): Promise<Record<string, unknown>> {
  const key = configuredBlindIndexKey();
  if (key === undefined || lookupableFields.length === 0) return {};
  const out: Record<string, unknown> = {};
  for (const name of lookupableFields) {
    if (!(name in values)) continue;
    out[blindIndexFieldName(name)] = await blindIndexForValue(key, name, values[name]);
  }
  return out;
}

async function blindIndexForValue(
  key: Uint8Array,
  field: string,
  value: unknown,
): Promise<string | null> {
  if (typeof value !== "string" || value === PII_ERASED_SENTINEL) return null;
  if (!isPiiCiphertext(value)) return computeBlindIndex(key, value);
  const kms = configuredPiiSubjectKms();
  // Ciphertext without a KMS can't be decrypted here; the same read would
  // also surface raw ciphertext — misconfiguration is caught at boot.
  if (kms === undefined) return null;
  const decrypted = await decryptPiiFieldValues({ [field]: value }, [field], kms, {
    requestId: requestContext.get()?.requestId ?? "blind-index",
  });
  const plain = decrypted[field];
  if (typeof plain !== "string" || plain === PII_ERASED_SENTINEL) return null;
  return computeBlindIndex(key, plain);
}
