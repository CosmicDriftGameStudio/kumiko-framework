// fw#2593 — the plaintext `read_users_email_unique` index used to be a full
// unique index regardless of softDelete: a soft-deleted user permanently
// blocked reuse of its email whenever PII/blind-index wasn't configured
// (the *_bidx partial index from fw#2464 only helps once a blind-index key
// is actually configured). buildEntityTable / deriveEntityTableMeta now
// attach `WHERE "is_deleted" = false` to any explicitly declared unique
// index on a softDelete entity that doesn't carry an author-provided
// `where` of its own — this proves the plaintext path directly, with no
// blind-index key configured at all.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestDb,
  type TestDb,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/testing";
import { userEntity, userTable } from "../schema/user";

let testDb: TestDb;
const executor = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, userEntity, "user");
  await createEventsTable(testDb.db);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, read_users RESTART IDENTITY CASCADE`,
  );
  // The premise of this file is "nothing configured" — global crypto state
  // from another test file running first in the same process must not leak
  // in and accidentally exercise the bidx path instead of the plaintext one.
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
});

describe("fw#2593 — email unique constraint on the plaintext column (no blind index configured)", () => {
  test("a soft-deleted user's email is reusable when no blind index is configured", async () => {
    const email = "plaintext-soft-deleted@example.com";
    const tdb = createTenantDb(testDb.db, SYSTEM_TENANT_ID, "system");
    const systemUser = createSystemUser(SYSTEM_TENANT_ID);

    const created = await executor.create(
      { email, displayName: "Departing Plaintext User" },
      systemUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("expected create to succeed");

    const deleted = await executor.delete({ id: created.data.id }, systemUser, tdb);
    if (!deleted.isSuccess) throw new Error("expected soft-delete to succeed");

    const reCreated = await executor.create(
      { email, displayName: "Plaintext Squatter" },
      systemUser,
      tdb,
    );
    if (!reCreated.isSuccess) {
      throw new Error(
        "expected re-create with the same email to succeed once the original row is soft-deleted",
      );
    }
    expect(reCreated.data.id).not.toBe(created.data.id);

    // DB-proof: both rows survive under the plaintext email — the
    // soft-deleted original stays untouched, the new live row now also
    // carries the email, since the partial index only enforces uniqueness
    // among non-deleted rows.
    const rows = (await asRawClient(testDb.db).unsafe(
      `SELECT "id", "is_deleted" FROM "read_users" WHERE "email" = $1 ORDER BY "is_deleted"`,
      [email],
    )) as ReadonlyArray<{ id: string; is_deleted: boolean }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ id: String(reCreated.data.id), is_deleted: false });
    expect(rows[1]).toEqual({ id: String(created.data.id), is_deleted: true });

    // Proves the plaintext path was actually exercised, not the bidx one:
    // no blind-index key is configured in this file, so email_bidx stays NULL.
    const plaintextRows = (await asRawClient(testDb.db).unsafe(
      `SELECT "email", "email_bidx" FROM "read_users" WHERE "id" = $1::uuid`,
      [reCreated.data.id],
    )) as ReadonlyArray<{ email: string; email_bidx: string | null }>;
    expect(plaintextRows[0]?.email).toBe(email);
    expect(plaintextRows[0]?.email_bidx).toBeNull();
  });

  test("a second live user with the same email is still rejected", async () => {
    const email = "plaintext-live-collision@example.com";
    const tdb = createTenantDb(testDb.db, SYSTEM_TENANT_ID, "system");
    const systemUser = createSystemUser(SYSTEM_TENANT_ID);

    const first = await executor.create(
      { email, displayName: "First Plaintext User" },
      systemUser,
      tdb,
    );
    if (!first.isSuccess) throw new Error("expected first create to succeed");

    const second = await executor.create(
      { email, displayName: "Second Plaintext User" },
      systemUser,
      tdb,
    );
    if (second.isSuccess) {
      throw new Error("expected second create with the same live email to fail");
    }

    expect(second.error.code).toBe("unique_violation");
    expect(second.error.httpStatus).toBe(409);
    const details = second.error.details as { constraintName?: string };
    expect(details.constraintName).toBe("read_users_email_unique");

    // DB-proof: only the first row survives under that email.
    const rows = (await asRawClient(testDb.db).unsafe(
      `SELECT count(*)::int AS n FROM "read_users" WHERE "email" = $1`,
      [email],
    )) as ReadonlyArray<{ n: number }>;
    expect(rows[0]?.n).toBe(1);
  });
});
