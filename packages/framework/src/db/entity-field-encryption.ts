import type { EntityDefinition } from "../engine/types";
import type { EncryptionProvider } from "./encryption";
import { createEncryptionProvider } from "./encryption";

export function collectEncryptedFieldNames(entity: EntityDefinition): ReadonlySet<string> {
  const names = new Set<string>();
  for (const [name, field] of Object.entries(entity.fields)) {
    if ((field.type === "text" || field.type === "longText") && field.encrypted === true) {
      names.add(name);
    }
  }
  return names;
}

function encryptFieldValue(
  fieldName: string,
  value: unknown,
  encryption: EncryptionProvider,
): string {
  if (value === null || value === undefined) {
    throw new Error(`encrypted field "${fieldName}" cannot be null or undefined`);
  }
  if (typeof value !== "string") {
    throw new Error(`encrypted field "${fieldName}" must be a string, got ${typeof value}`);
  }
  return encryption.encrypt(value);
}

export function encryptEntityFieldValues(
  row: Record<string, unknown>,
  encryptedFields: ReadonlySet<string>,
  encryption: EncryptionProvider,
  opts?: { onlyKeys?: Iterable<string> },
): Record<string, unknown> {
  if (encryptedFields.size === 0) return row;
  const only = opts?.onlyKeys ? new Set(opts.onlyKeys) : null;
  const out = { ...row };
  for (const name of encryptedFields) {
    if (only && !only.has(name)) continue;
    if (!(name in out)) continue;
    const value = out[name];
    if (value === null || value === undefined) continue;
    out[name] = encryptFieldValue(name, value, encryption);
  }
  return out;
}

export function decryptEntityFieldValues(
  row: Record<string, unknown>,
  encryptedFields: ReadonlySet<string>,
  encryption: EncryptionProvider,
): Record<string, unknown> {
  if (encryptedFields.size === 0) return row;
  const out = { ...row };
  for (const name of encryptedFields) {
    const value = out[name];
    if (value === null || value === undefined) continue;
    if (typeof value !== "string") continue;
    out[name] = encryption.decrypt(value);
  }
  return out;
}

let cachedProvider: EncryptionProvider | undefined;

export function resolveEntityFieldEncryption(): EncryptionProvider {
  if (cachedProvider) return cachedProvider;
  const key = process.env["ENCRYPTION_KEY"];
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is required (encrypted entity fields in use)",
    );
  }
  cachedProvider = createEncryptionProvider(key);
  return cachedProvider;
}

/** @internal test-only */
export function resetEntityFieldEncryptionCacheForTests(): void {
  cachedProvider = undefined;
}
