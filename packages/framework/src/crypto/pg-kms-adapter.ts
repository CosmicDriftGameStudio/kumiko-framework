import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import postgres from "postgres";
import {
  KeyAlreadyExistsError,
  KeyErasedError,
  KeyNotFoundError,
  type KmsContext,
  type KmsHealth,
  type LocalKeyKmsAdapter,
  type SubjectDek,
  type SubjectId,
  subjectIdToKey,
} from "./kms-adapter";

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

// Envelope layout [iv:12][tag:16][ct] — the platform KEK wraps each subject
// DEK at rest, so a subject-keys-DB dump alone reveals no key material.
function wrapDek(kek: Buffer, dek: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function unwrapDek(kek: Buffer, wrapped: Uint8Array): SubjectDek {
  const envelope = Buffer.from(wrapped);
  const iv = envelope.subarray(0, IV_LENGTH);
  const tag = envelope.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = envelope.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", kek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function decodePlatformKek(base64: string): Buffer {
  const kek = Buffer.from(base64, "base64");
  if (kek.length !== 32) {
    throw new Error(
      `PgKmsAdapter: platformKek must decode to 32 bytes, got ${kek.length} — expected a base64-encoded AES-256 key (openssl rand -base64 32)`,
    );
  }
  return kek;
}

const PG_UNIQUE_VIOLATION = "23505";

function isPgUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === PG_UNIQUE_VIOLATION
  );
}

interface SubjectKeyRow {
  cipher_key: Uint8Array | null;
  kek_version: number;
  erased: boolean;
}

export interface PgKmsAdapterOptions {
  /** Connection string of the DEDICATED subject-keys cluster — never the app DB (its backup retention must stay shorter, see kms-adapter.md). */
  readonly databaseUrl: string;
  /** Base64-encoded 32-byte platform KEK (PLATFORM_KEK env var). */
  readonly platformKek: string;
  /** Version of `platformKek` as stored in kumiko_subject_keys.kek_version.
   *  Bump on rotation; new wraps carry this version. Default 1. */
  readonly kekVersion?: number;
  /** Older KEKs by version, kept ONLY during a rotation window so rows not
   *  yet re-wrapped stay readable. Drop after rewrapSubjectKeys reports the
   *  estate fully on the active version (runbook: kek-rotation.md). */
  readonly previousKeks?: Readonly<Record<number, string>>;
  readonly maxConnections?: number;
}

// Default production adapter: DEKs live in a separate Postgres cluster,
// KEK-wrapped at rest. Schema is created lazily on first use — the
// subject-keys cluster has no drizzle migration pipeline of its own.
export class PgKmsAdapter implements LocalKeyKmsAdapter {
  readonly capabilities = { mode: "local-key" } as const;

  private readonly sql: ReturnType<typeof postgres>;
  private readonly kek: Buffer;
  private readonly kekVersion: number;
  private readonly previousKeks: ReadonlyMap<number, Buffer>;
  private schemaReady: Promise<void> | undefined;

  constructor(options: PgKmsAdapterOptions) {
    this.kek = decodePlatformKek(options.platformKek);
    this.kekVersion = options.kekVersion ?? 1;
    const previous = new Map<number, Buffer>();
    for (const [version, kek] of Object.entries(options.previousKeks ?? {})) {
      const v = Number(version);
      if (v >= this.kekVersion) {
        throw new Error(
          `PgKmsAdapter: previousKeks[${v}] must be older than the active kekVersion ${this.kekVersion}`,
        );
      }
      previous.set(v, decodePlatformKek(kek));
    }
    this.previousKeks = previous;
    this.sql = postgres(options.databaseUrl, {
      max: options.maxConnections ?? 4,
      // The connection is exclusive to this adapter and its only DDL is
      // idempotent IF NOT EXISTS — notices are pure boot-log noise.
      onnotice: () => {},
    });
  }

  async createKey(subject: SubjectId, ctx: KmsContext): Promise<void> {
    await this.ensureSchema();
    const wrapped = wrapDek(this.kek, randomBytes(32));
    try {
      await this.sql`
        INSERT INTO kumiko_subject_keys (subject_id, cipher_key, kek_version, created_by)
        VALUES (${subjectIdToKey(subject)}, ${wrapped}, ${this.kekVersion}, ${ctx.userId ?? null})`;
    } catch (error) {
      if (isPgUniqueViolation(error)) throw new KeyAlreadyExistsError(subject);
      throw error;
    }
  }

  async getKey(subject: SubjectId, _ctx: KmsContext): Promise<SubjectDek> {
    await this.ensureSchema();
    const rows = await this.sql<SubjectKeyRow[]>`
      SELECT cipher_key, kek_version, (erased_at IS NOT NULL) AS erased
      FROM kumiko_subject_keys
      WHERE subject_id = ${subjectIdToKey(subject)}`;
    const row = rows[0];
    if (!row) throw new KeyNotFoundError(subject);
    if (row.erased || row.cipher_key === null) throw new KeyErasedError(subject);
    return unwrapDek(this.kekFor(row.kek_version, subject), row.cipher_key);
  }

  // Rows keep working mid-rotation: not-yet-rewrapped DEKs name their KEK
  // generation and unwrap with the matching previous key. A version with no
  // configured key is a hard config error — NOT a shredded subject.
  private kekFor(version: number, subject: SubjectId): Buffer {
    if (version === this.kekVersion) return this.kek;
    const previous = this.previousKeks.get(version);
    if (previous) return previous;
    throw new Error(
      `PgKmsAdapter: subject ${subjectIdToKey(subject)} is wrapped with KEK version ${version} but only version ${this.kekVersion}${this.previousKeks.size > 0 ? ` (+previous ${[...this.previousKeks.keys()].join(",")})` : ""} is configured — pass previousKeks during rotation (runbook: kek-rotation.md).`,
    );
  }

  async eraseKey(subject: SubjectId, ctx: KmsContext): Promise<void> {
    await this.ensureSchema();
    // Guard on erased_at IS NULL keeps repeat erases from overwriting the
    // original tombstone audit fields; unknown subjects update zero rows.
    await this.sql`
      UPDATE kumiko_subject_keys
      SET cipher_key = NULL,
          erased_at = now(),
          erased_by = ${ctx.userId ?? null},
          erase_reason = ${ctx.eraseReason ?? null}
      WHERE subject_id = ${subjectIdToKey(subject)} AND erased_at IS NULL`;
  }

  async health(): Promise<KmsHealth> {
    const start = Date.now();
    await this.ensureSchema();
    await this.sql`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  private ensureSchema(): Promise<void> {
    // A failed attempt resets the memo so a transient DB outage does not
    // poison the adapter for the rest of the process lifetime.
    this.schemaReady ??= this.createSchema().catch((error) => {
      this.schemaReady = undefined;
      throw error;
    });
    return this.schemaReady;
  }

  private async createSchema(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS kumiko_subject_keys (
        subject_id    TEXT        PRIMARY KEY,
        cipher_key    BYTEA,
        kek_version   INTEGER     NOT NULL DEFAULT 1,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by    TEXT,
        erased_at     TIMESTAMPTZ,
        erased_by     TEXT,
        erase_reason  TEXT
      )`;
    await this.sql`
      CREATE INDEX IF NOT EXISTS kumiko_subject_keys_erased_idx
      ON kumiko_subject_keys (erased_at) WHERE erased_at IS NOT NULL`;
    await this.sql`
      CREATE INDEX IF NOT EXISTS kumiko_subject_keys_audit_idx
      ON kumiko_subject_keys (created_at, erased_at)`;
  }
}

export function createPgKmsAdapter(options: PgKmsAdapterOptions): PgKmsAdapter {
  return new PgKmsAdapter(options);
}

export interface RewrapOptions {
  readonly databaseUrl: string;
  /** Older KEKs by version — every version still present in the table must be covered. */
  readonly fromKeks: Readonly<Record<number, string>>;
  /** The new active KEK and its version (previous active version + 1). */
  readonly toKek: string;
  readonly toKekVersion: number;
  readonly batchSize?: number;
  readonly dryRun?: boolean;
}

export interface RewrapResult {
  readonly scanned: number;
  readonly rewrapped: number;
  readonly skippedErased: number;
  readonly failures: ReadonlyArray<{ readonly subjectId: string; readonly reason: string }>;
}

// One-time KEK rotation (runbook: kek-rotation.md). Unwraps every live DEK
// wrapped with an older KEK generation and re-wraps it under the new KEK,
// bumping kek_version. Idempotent: rows already on toKekVersion are not
// selected; a second run reports 0. Erased tombstones (cipher_key NULL) are
// never touched. The UPDATE is guarded on the row's old kek_version, so a
// concurrent app writing fresh keys on the new version is never clobbered.
export async function rewrapSubjectKeys(options: RewrapOptions): Promise<RewrapResult> {
  const toKek = decodePlatformKek(options.toKek);
  const fromKeks = new Map<number, Buffer>();
  for (const [version, kek] of Object.entries(options.fromKeks)) {
    fromKeks.set(Number(version), decodePlatformKek(kek));
  }
  const batchSize = options.batchSize ?? 200;
  const sql = postgres(options.databaseUrl, { max: 2, onnotice: () => {} });

  const result = {
    scanned: 0,
    rewrapped: 0,
    skippedErased: 0,
    failures: [] as Array<{ subjectId: string; reason: string }>,
  };
  try {
    let cursor = "";
    for (;;) {
      const rows = await sql<
        Array<{ subject_id: string; cipher_key: Uint8Array | null; kek_version: number }>
      >`
        SELECT subject_id, cipher_key, kek_version
        FROM kumiko_subject_keys
        WHERE kek_version <> ${options.toKekVersion} AND subject_id > ${cursor}
        ORDER BY subject_id ASC
        LIMIT ${batchSize}`;
      if (rows.length === 0) break;

      for (const row of rows) {
        result.scanned++;
        if (row.cipher_key === null) {
          result.skippedErased++;
          continue;
        }
        try {
          const fromKek = fromKeks.get(row.kek_version);
          if (!fromKek) {
            throw new Error(`no fromKek configured for kek_version ${row.kek_version}`);
          }
          const rewrapped = wrapDek(toKek, unwrapDek(fromKek, row.cipher_key));
          if (!options.dryRun) {
            await sql`
              UPDATE kumiko_subject_keys
              SET cipher_key = ${rewrapped}, kek_version = ${options.toKekVersion}
              WHERE subject_id = ${row.subject_id} AND kek_version = ${row.kek_version}`;
          }
          result.rewrapped++;
        } catch (error) {
          result.failures.push({
            subjectId: row.subject_id,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const last = rows[rows.length - 1];
      if (last === undefined) break;
      cursor = last.subject_id;
    }
  } finally {
    await sql.end();
  }
  return result;
}
