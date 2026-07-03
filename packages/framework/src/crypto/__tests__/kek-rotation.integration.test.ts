// KEK rotation (#818 step 7): mid-rotation an adapter with the NEW active
// KEK + previousKeks reads old-generation rows; rewrapSubjectKeys migrates
// the estate to the new generation; afterwards previousKeks can be dropped.
// Erased tombstones stay untouched, unknown generations fail loud as a
// CONFIG error (not a shredded subject).

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createTestDb } from "../../stack/db";
import type { KmsContext, SubjectId } from "../kms-adapter";
import { createPgKmsAdapter, rewrapSubjectKeys } from "../pg-kms-adapter";

const baseUrl = process.env["TEST_DATABASE_URL"];
if (!baseUrl) throw new Error("Missing required env var: TEST_DATABASE_URL");

const testDb = await createTestDb();
const DB_URL = baseUrl.replace(/\/[^/]+$/, `/${testDb.dbName}`);

const KEK_V1 = Buffer.alloc(32, 1).toString("base64");
const KEK_V2 = Buffer.alloc(32, 2).toString("base64");
const ctx: KmsContext = { requestId: "kek-rotation-test" };
const freshUser = (): SubjectId => ({ kind: "user", userId: randomUUID() });

const raw = postgres(DB_URL, { max: 1, onnotice: () => {} });

afterAll(async () => {
  await raw.end();
  await testDb.cleanup();
});

beforeEach(async () => {
  const boot = createPgKmsAdapter({ databaseUrl: DB_URL, platformKek: KEK_V1 });
  await boot.health();
  await boot.close();
  await raw`TRUNCATE kumiko_subject_keys`;
});

async function seedV1Keys(count: number): Promise<SubjectId[]> {
  const v1 = createPgKmsAdapter({ databaseUrl: DB_URL, platformKek: KEK_V1 });
  const subjects: SubjectId[] = [];
  for (let i = 0; i < count; i++) {
    const subject = freshUser();
    await v1.createKey(subject, ctx);
    subjects.push(subject);
  }
  await v1.close();
  return subjects;
}

describe("KEK rotation", () => {
  test("mid-rotation adapter (new active + previousKeks) reads v1 rows; new writes carry v2", async () => {
    const [oldSubject] = await seedV1Keys(1);
    if (!oldSubject) throw new Error("seed failed");

    const rotating = createPgKmsAdapter({
      databaseUrl: DB_URL,
      platformKek: KEK_V2,
      kekVersion: 2,
      previousKeks: { 1: KEK_V1 },
    });
    const dek = await rotating.getKey(oldSubject, ctx);
    expect(dek.length).toBe(32);

    const newSubject = freshUser();
    await rotating.createKey(newSubject, ctx);
    const versions = await raw<Array<{ kek_version: number }>>`
      SELECT kek_version FROM kumiko_subject_keys ORDER BY kek_version`;
    expect(versions.map((r) => r.kek_version)).toEqual([1, 2]);
    await rotating.close();
  });

  test("unknown generation without previousKeks is a loud config error", async () => {
    const [oldSubject] = await seedV1Keys(1);
    if (!oldSubject) throw new Error("seed failed");

    const misconfigured = createPgKmsAdapter({
      databaseUrl: DB_URL,
      platformKek: KEK_V2,
      kekVersion: 2,
    });
    expect(misconfigured.getKey(oldSubject, ctx)).rejects.toThrow(/pass previousKeks/);
    await misconfigured.close();
  });

  test("previousKeks newer than the active version is rejected at construction", () => {
    expect(() =>
      createPgKmsAdapter({
        databaseUrl: DB_URL,
        platformKek: KEK_V1,
        kekVersion: 1,
        previousKeks: { 2: KEK_V2 },
      }),
    ).toThrow(/must be older/);
  });

  test("rewrapSubjectKeys migrates the estate; DEKs stay identical; idempotent", async () => {
    const subjects = await seedV1Keys(3);
    const v1 = createPgKmsAdapter({ databaseUrl: DB_URL, platformKek: KEK_V1 });
    const before = await Promise.all(subjects.map((s) => v1.getKey(s, ctx)));
    await v1.close();

    const result = await rewrapSubjectKeys({
      databaseUrl: DB_URL,
      fromKeks: { 1: KEK_V1 },
      toKek: KEK_V2,
      toKekVersion: 2,
      batchSize: 2,
    });
    expect(result.failures).toEqual([]);
    expect(result.rewrapped).toBe(3);

    // The rotated estate is fully readable with ONLY the new KEK — and the
    // unwrapped DEKs are byte-identical (stored ciphertext stays decryptable).
    const v2 = createPgKmsAdapter({ databaseUrl: DB_URL, platformKek: KEK_V2, kekVersion: 2 });
    const after = await Promise.all(subjects.map((s) => v2.getKey(s, ctx)));
    for (const [i, dek] of after.entries()) {
      expect(dek.equals(before[i] as Buffer)).toBe(true);
    }
    await v2.close();

    const second = await rewrapSubjectKeys({
      databaseUrl: DB_URL,
      fromKeks: { 1: KEK_V1 },
      toKek: KEK_V2,
      toKekVersion: 2,
    });
    expect(second.scanned).toBe(0);
    expect(second.rewrapped).toBe(0);
  });

  test("erased tombstones are skipped and stay erased", async () => {
    const [gone] = await seedV1Keys(1);
    if (!gone) throw new Error("seed failed");
    const v1 = createPgKmsAdapter({ databaseUrl: DB_URL, platformKek: KEK_V1 });
    await v1.eraseKey(gone, ctx);
    await v1.close();

    const result = await rewrapSubjectKeys({
      databaseUrl: DB_URL,
      fromKeks: { 1: KEK_V1 },
      toKek: KEK_V2,
      toKekVersion: 2,
    });
    expect(result.skippedErased).toBe(1);
    expect(result.rewrapped).toBe(0);

    const rows = await raw<Array<{ cipher_key: Uint8Array | null }>>`
      SELECT cipher_key FROM kumiko_subject_keys`;
    expect(rows[0]?.cipher_key).toBeNull();
  });

  test("dryRun counts but writes nothing", async () => {
    await seedV1Keys(2);
    const dry = await rewrapSubjectKeys({
      databaseUrl: DB_URL,
      fromKeks: { 1: KEK_V1 },
      toKek: KEK_V2,
      toKekVersion: 2,
      dryRun: true,
    });
    expect(dry.rewrapped).toBe(2);
    const versions = await raw<Array<{ kek_version: number }>>`
      SELECT DISTINCT kek_version FROM kumiko_subject_keys`;
    expect(versions.map((r) => r.kek_version)).toEqual([1]);
  });

  test("missing fromKek for a generation lands in failures, not a crash", async () => {
    await seedV1Keys(1);
    const result = await rewrapSubjectKeys({
      databaseUrl: DB_URL,
      fromKeks: {},
      toKek: KEK_V2,
      toKekVersion: 2,
    });
    expect(result.rewrapped).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.reason).toContain("no fromKek configured");
  });
});
