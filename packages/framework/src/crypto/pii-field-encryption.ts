// PII field encryption with per-subject DEKs (crypto-shredding, #724 phase C).
// Same executor hook points as `encrypted: true`, but the key belongs to the
// erase subject — kms.eraseKey(subject) makes every value unreadable at once.
// Storage format is a sniffable string that fits existing text columns and
// names its subject inline, so decrypt needs no schema change and no resolver:
//   kumiko-pii:v1:<subjectKey>:<base64(iv|tag|ciphertext)>

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { EntityDefinition } from "../engine/types/fields";
import type { TenantId } from "../engine/types/identifiers";
import {
  isLocalKeyKmsAdapter,
  KeyAlreadyExistsError,
  KeyErasedError,
  KeyNotFoundError,
  type KmsAdapter,
  type KmsContext,
  type LocalKeyKmsAdapter,
  type SubjectDek,
  type SubjectId,
  subjectIdFromKey,
  subjectIdToKey,
} from "./kms-adapter";
import { resolveSubjectForField } from "./subject-resolver";

// Spec value (crypto-shredding.md) — renderers show it verbatim.
export const PII_ERASED_SENTINEL = "[[erased]]";

const PII_CIPHERTEXT_PREFIX = "kumiko-pii:v1:";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export function isPiiCiphertext(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(PII_CIPHERTEXT_PREFIX);
}

function encryptValue(subject: SubjectId, dek: SubjectDek, plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", dek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const blob = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  return `${PII_CIPHERTEXT_PREFIX}${subjectIdToKey(subject)}:${blob.toString("base64")}`;
}

function parseCiphertext(value: string): { subject: SubjectId; blob: Buffer } {
  const rest = value.slice(PII_CIPHERTEXT_PREFIX.length);
  // subjectKey itself contains ":" ("user:<id>") — base64 never does, so the
  // last ":" is always the key/blob separator.
  const sep = rest.lastIndexOf(":");
  if (sep === -1) throw new Error(`Malformed PII ciphertext (no subject/blob separator)`);
  return {
    subject: subjectIdFromKey(rest.slice(0, sep)),
    blob: Buffer.from(rest.slice(sep + 1), "base64"),
  };
}

function decryptValue(dek: SubjectDek, blob: Buffer): string {
  const iv = blob.subarray(0, IV_LENGTH);
  const tag = blob.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", dek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

// First write to a PII field of a new subject creates the key implicitly
// (user-signup / tenant-create need no extra hook). The AlreadyExists catch
// covers the concurrent-first-write race; a tombstoned subject re-throws
// KeyErasedError from the final getKey — writes to a forgotten subject fail.
async function getOrCreateDek(
  kms: LocalKeyKmsAdapter,
  subject: SubjectId,
  ctx: KmsContext,
): Promise<SubjectDek> {
  try {
    return await kms.getKey(subject, ctx);
  } catch (e) {
    if (!(e instanceof KeyNotFoundError)) throw e;
  }
  try {
    await kms.createKey(subject, ctx);
  } catch (e) {
    if (!(e instanceof KeyAlreadyExistsError)) throw e;
  }
  return kms.getKey(subject, ctx);
}

export interface EncryptPiiOptions {
  readonly onlyKeys?: Iterable<string>;
  // Write-time tenant for tenantOwned fields on rows without a tenantId column.
  readonly tenantId?: TenantId;
  // Row to resolve subjects from when `row` is a partial (update changes may
  // carry a pii field without its ownerField — the merged row still has it).
  readonly subjectSource?: Record<string, unknown>;
}

export async function encryptPiiFieldValues(
  row: Record<string, unknown>,
  entity: EntityDefinition,
  piiFields: readonly string[],
  kms: LocalKeyKmsAdapter,
  kmsCtx: KmsContext,
  opts: EncryptPiiOptions = {},
): Promise<Record<string, unknown>> {
  if (piiFields.length === 0) return row;
  const only = opts.onlyKeys ? new Set(opts.onlyKeys) : null;
  const subjectSource = opts.subjectSource ?? row;
  const out = { ...row };
  for (const name of piiFields) {
    if (only && !only.has(name)) continue;
    if (!(name in out)) continue;
    const value = out[name];
    if (value === null || value === undefined) continue;
    // Re-encrypt paths (update previous, detail cache) may see values that
    // are already ciphertext or the erased sentinel — both stay as-is.
    if (isPiiCiphertext(value) || value === PII_ERASED_SENTINEL) continue;
    if (typeof value !== "string") {
      throw new Error(`PII field "${name}" must be a string, got ${typeof value}`);
    }
    const subject = resolveSubjectForField(entity, name, subjectSource, {
      ...(opts.tenantId !== undefined && { tenantId: opts.tenantId }),
    });
    // skip: collectPiiSubjectFields only yields annotated fields — null is unreachable, kept as a type guard
    if (subject === null) continue;
    const dek = await getOrCreateDek(kms, subject, kmsCtx);
    out[name] = encryptValue(subject, dek, value);
  }
  return out;
}

export async function decryptPiiFieldValues(
  row: Record<string, unknown>,
  piiFields: readonly string[],
  kms: LocalKeyKmsAdapter,
  kmsCtx: KmsContext,
): Promise<Record<string, unknown>> {
  if (piiFields.length === 0) return row;
  const out = { ...row };
  for (const name of piiFields) {
    const value = out[name];
    // Pre-engine plaintext rows pass through unchanged (mixed-state reads
    // work during rollout; backfill is tracked in kumiko-framework#799).
    if (!isPiiCiphertext(value)) continue;
    const { subject, blob } = parseCiphertext(value);
    try {
      out[name] = decryptValue(await kms.getKey(subject, kmsCtx), blob);
    } catch (e) {
      // KeyNotFound deliberately propagates: ciphertext without a key row
      // means the key store is wrong (not shredded) — fail loud.
      if (!(e instanceof KeyErasedError)) throw e;
      out[name] = PII_ERASED_SENTINEL;
    }
  }
  return out;
}

// Boot-injected app-wide subject KMS, mirroring configureEntityFieldEncryption:
// run{Prod,Dev}App call configurePiiSubjectKms once; executors resolve lazily.
// Absent adapter = engine off (pii fields stay plaintext, pre-phase-C
// behavior) — the hard boot gate arrives with the prod-grade PgKmsAdapter
// (phase E); until then no production deployment can satisfy it.
let injectedKms: LocalKeyKmsAdapter | undefined;

export function configurePiiSubjectKms(adapter: KmsAdapter | undefined): void {
  if (adapter !== undefined && !isLocalKeyKmsAdapter(adapter)) {
    throw new Error(
      "PII field encryption requires a local-key KMS adapter — remote-crypto " +
        "(Vault transit) support lands with the BYOK adapter.",
    );
  }
  injectedKms = adapter;
}

export function configuredPiiSubjectKms(): LocalKeyKmsAdapter | undefined {
  return injectedKms;
}

/** @internal test-only */
export function resetPiiSubjectKmsForTests(): void {
  injectedKms = undefined;
}
