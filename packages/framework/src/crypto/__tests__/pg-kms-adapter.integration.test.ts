import { afterAll, describe, expect, test } from "bun:test";
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { createTestDb } from "../../stack/db";
import { type KmsContext, type SubjectId, subjectIdToKey } from "../kms-adapter";
import { PgKmsAdapter } from "../pg-kms-adapter";
import { describeKmsAdapterContract } from "./kms-adapter-contract";

const baseUrl = process.env["TEST_DATABASE_URL"];
if (!baseUrl) throw new Error("Missing required env var: TEST_DATABASE_URL");

const testDb = await createTestDb();
const databaseUrl = baseUrl.replace(/\/[^/]+$/, `/${testDb.dbName}`);
const platformKek = randomBytes(32).toString("base64");
const adapter = new PgKmsAdapter({ databaseUrl, platformKek, maxConnections: 2 });
const raw = postgres(databaseUrl, { max: 1 });

afterAll(async () => {
  await adapter.close();
  await raw.end();
  await testDb.cleanup();
});

describeKmsAdapterContract("PgKmsAdapter", async () => {
  // health() creates the schema lazily, so the truncate cannot hit a
  // missing table on the first run; contract tests reuse fixed subject ids.
  await adapter.health();
  await raw`TRUNCATE kumiko_subject_keys`;
  return adapter;
});

describe("PgKmsAdapter — pg specifics", () => {
  const ctx: KmsContext = { requestId: "pg-kms-test" };
  const freshUser = (): SubjectId => ({ kind: "user", userId: randomUUID() });

  test("rejects a platformKek that does not decode to 32 bytes", () => {
    expect(
      () =>
        new PgKmsAdapter({
          databaseUrl,
          platformKek: Buffer.from("too-short").toString("base64"),
        }),
    ).toThrow("32 bytes");
  });

  test("DEKs survive across adapter instances", async () => {
    const user = freshUser();
    await adapter.createKey(user, ctx);
    const dek = await adapter.getKey(user, ctx);

    const second = new PgKmsAdapter({ databaseUrl, platformKek, maxConnections: 1 });
    try {
      const rehydrated = await second.getKey(user, ctx);
      expect(rehydrated.equals(dek)).toBe(true);
    } finally {
      await second.close();
    }
  });

  test("a different platform KEK cannot unwrap stored DEKs", async () => {
    const user = freshUser();
    await adapter.createKey(user, ctx);

    const wrongKek = new PgKmsAdapter({
      databaseUrl,
      platformKek: randomBytes(32).toString("base64"),
      maxConnections: 1,
    });
    try {
      await expect(wrongKek.getKey(user, ctx)).rejects.toThrow();
    } finally {
      await wrongKek.close();
    }
  });

  test("erase leaves an audit tombstone without key material", async () => {
    const user = freshUser();
    await adapter.createKey(user, ctx);
    await adapter.eraseKey(user, {
      requestId: "pg-kms-test",
      userId: "operator-1",
      eraseReason: "user-forget",
    });

    const rows = await raw`
      SELECT cipher_key, erased_at, erased_by, erase_reason
      FROM kumiko_subject_keys
      WHERE subject_id = ${subjectIdToKey(user)}`;
    expect(rows.length).toBe(1);
    expect(rows[0]?.["cipher_key"]).toBeNull();
    expect(rows[0]?.["erased_at"]).not.toBeNull();
    expect(rows[0]?.["erased_by"]).toBe("operator-1");
    expect(rows[0]?.["erase_reason"]).toBe("user-forget");
  });

  test("repeat erase keeps the original tombstone audit fields", async () => {
    const user = freshUser();
    await adapter.createKey(user, ctx);
    await adapter.eraseKey(user, {
      requestId: "pg-kms-test",
      userId: "operator-1",
      eraseReason: "user-forget",
    });
    await adapter.eraseKey(user, {
      requestId: "pg-kms-test",
      userId: "operator-2",
      eraseReason: "tenant-destroy",
    });

    const rows = await raw`
      SELECT erased_by, erase_reason
      FROM kumiko_subject_keys
      WHERE subject_id = ${subjectIdToKey(user)}`;
    expect(rows[0]?.["erased_by"]).toBe("operator-1");
    expect(rows[0]?.["erase_reason"]).toBe("user-forget");
  });
});
