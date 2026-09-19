// Blind-Index für PII-Equality-Lookups (kumiko-framework#818).
// `lookupable: true` auf einem Subject-annotierten text-Feld erzeugt eine
// generierte Spalte `<snake>_bidx` mit deterministischem HMAC über den
// KLARTEXT-Wert — Equality-Queries matchen `(col = $1 OR col_bidx = $2)`
// und funktionieren damit für Klartext-Alt-Rows UND verschlüsselte Rows.
//
// Wertformat: kumiko-bidx:v1:<base64url(HMAC-SHA256(key, value))>
//
// HMAC ist byte-exact ohne Normalisierung — repliziert exakt die heutige
// case-sensitive Equality-Semantik (Lowercasing wäre eine Verhaltensänderung).
//
// Der Key ist bewusst ein EIGENER 32-Byte-Key (env: KUMIKO_BLIND_INDEX_KEY),
// nicht vom PLATFORM_KEK abgeleitet und nicht Teil des KmsAdapter-Contracts —
// BYOK-Adapter dürfen ihn nie sehen. Rotation = Recompute aller bidx-Spalten
// (Rollout-Fahrplan Schritt 7).
//
// bidx-Werte leben NUR in der Projektion, nie in Event-Payloads: ein
// deterministischer HMAC im immutablen Event wäre permanente Linkage und
// bräche Forget. applyEntityEvent berechnet sie beim Apply (live + rebuild),
// nach Key-Erase recomputet der Rebuild sie zu NULL.

import { createHmac } from "node:crypto";
import { requestContext } from "../api/request-context";
import type { EntityDefinition } from "../engine/types/fields";
import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
} from "./pii-field-encryption";

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
// lookups match plaintext rows only — pre-#818 behavior).
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
  if (key === undefined) {
    assertNoUnkeyedCiphertext(values, lookupableFields);
    return {};
  }
  if (lookupableFields.length === 0) return {};
  const out: Record<string, unknown> = {};
  for (const name of lookupableFields) {
    if (!(name in values)) continue;
    out[blindIndexFieldName(name)] = await blindIndexForValue(key, name, values[name]);
  }
  return out;
}

// The bidx column is schema-driven (entity-table-meta.ts), not KMS-driven — a
// plaintext install has it too, always NULL, by design (pre-#818 behavior).
// A ciphertext value with no key configured means the opposite: encryption IS
// active but the blind-index key wasn't wired alongside it. Silently returning
// {} would null out the bidx column for an encrypted row instead of failing
// (fw#3091); a plaintext install never produces ciphertext here, so this stays
// a no-op for the common case.
function assertNoUnkeyedCiphertext(
  values: Record<string, unknown>,
  lookupableFields: readonly string[],
): void {
  for (const name of lookupableFields) {
    const value = values[name];
    if (typeof value !== "string" || value === PII_ERASED_SENTINEL) continue;
    if (!isPiiCiphertext(value)) continue;
    throw new Error(
      `Blind-index for field "${name}" found PII ciphertext but no blind-index key is configured. ` +
        "Set KUMIKO_BLIND_INDEX_KEY before this apply/rebuild runs (fw#3091).",
    );
  }
}

async function blindIndexForValue(
  key: Uint8Array,
  field: string,
  value: unknown,
): Promise<string | null> {
  if (typeof value !== "string" || value === PII_ERASED_SENTINEL) return null;
  if (!isPiiCiphertext(value)) return computeBlindIndex(key, value);
  const kms = configuredPiiSubjectKms();
  // Ciphertext without a KMS can't be decrypted here — unlike the plaintext
  // path, silently returning null would write NULL into the bidx column
  // instead of the real index (fw#3091), so this fails loud instead.
  if (kms === undefined) {
    throw new Error(
      `Blind-index for field "${field}" found PII ciphertext but no PII-subject KMS is configured — ` +
        "cannot decrypt to compute the HMAC over plaintext. Configure the PII-subject KMS before this " +
        "apply/rebuild runs (fw#3091).",
    );
  }
  const decrypted = await decryptPiiFieldValues({ [field]: value }, [field], kms, {
    requestId: requestContext.get()?.requestId ?? "blind-index",
  });
  const plain = decrypted[field];
  if (typeof plain !== "string" || plain === PII_ERASED_SENTINEL) return null;
  return computeBlindIndex(key, plain);
}
