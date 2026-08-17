// fw#2134 — user:create's email-uniqueness check used to be a pure
// pre-flight fetchOne (TOCTOU: two concurrent creates can both pass the
// pre-flight and both insert, see handlers/create.write.ts). This proves
// the DB-level fix directly against the executor (bypassing the handler's
// pre-flight entirely) — a unique index over email's blind-index column
// rejects the loser of a genuine race, and the framework's F8 pg-23505
// mapping turns that into a clean 409 unique_violation, not a 500.
//
// createTestDb wires no blind-index key by default (see
// blind-index.integration.test.ts) — without configureBlindIndexKey the
// email_bidx column stays NULL for every row, the partial bidx unique
// index never applies, and a race "passing" here would prove nothing. So
// this test configures one explicitly and then proves the loser was
// actually rejected on the bidx constraint (not the plaintext-fallback
// index) by asserting the constraint name and reading email_bidx back off
// the surviving row.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  computeBlindIndex,
  configureBlindIndexKey,
  configurePiiSubjectKms,
  decodeBlindIndexKey,
  InMemoryKmsAdapter,
} from "@cosmicdrift/kumiko-framework/crypto";
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

const TEST_KEY_B64 = Buffer.alloc(32, 9).toString("base64");
const TEST_KEY = decodeBlindIndexKey(TEST_KEY_B64);

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
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  configureBlindIndexKey(TEST_KEY_B64);
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
});

describe("fw#2134 — email unique constraint on the blind-index column", () => {
  test("two concurrent creates with the same email: exactly one wins, loser fails on the bidx constraint", async () => {
    const email = "race@example.com";
    const tdb = createTenantDb(testDb.db, SYSTEM_TENANT_ID, "system");
    const systemUser = createSystemUser(SYSTEM_TENANT_ID);

    const [first, second] = await Promise.all([
      executor.create({ email, displayName: "Racer One" }, systemUser, tdb),
      executor.create({ email, displayName: "Racer Two" }, systemUser, tdb),
    ]);

    const winner = first.isSuccess ? first : second;
    const loser = first.isSuccess ? second : first;
    if (loser.isSuccess || !winner.isSuccess) {
      throw new Error("expected exactly one winner and one loser out of the two racing creates");
    }

    expect(loser.error.code).toBe("unique_violation");
    expect(loser.error.httpStatus).toBe(409);
    const details = loser.error.details as { constraintName?: string };
    expect(details.constraintName).toBe("read_users_email_unique_bidx");

    // Proves the race was actually decided by the blind-index constraint,
    // not the plaintext-fallback index: the surviving row's bidx column
    // carries the deterministic HMAC of the email.
    const rows = (await asRawClient(testDb.db).unsafe(
      `SELECT "email_bidx" FROM "read_users" WHERE "id" = $1::uuid`,
      [winner.data.id],
    )) as ReadonlyArray<{ email_bidx: string | null }>;
    expect(rows[0]?.email_bidx).toBe(computeBlindIndex(TEST_KEY, email));

    // DB-proof: only one row actually survives under that blind index.
    const survivors = (await asRawClient(testDb.db).unsafe(
      `SELECT count(*)::int AS n FROM "read_users" WHERE "email_bidx" = $1`,
      [computeBlindIndex(TEST_KEY, email)],
    )) as ReadonlyArray<{ n: number }>;
    expect(survivors[0]?.n).toBe(1);
  });

  test("a soft-deleted user still holds its email: constraint agrees with the pre-existing pre-flight behavior", async () => {
    // Soft-delete only flips isDeleted/deletedAt (apply-entity-event.ts) —
    // it never touches email/email_bidx, so the row still occupies the
    // unique slot. This isn't new behavior from fw#2134: the handler's
    // pre-flight fetchOne is a raw, unfiltered query (see create.write.ts)
    // and already saw soft-deleted rows before this fix. This test pins
    // that the new DB constraint doesn't diverge from that — only the
    // GDPR "forgotten" hard-delete (see forget-cleanup) actually frees the
    // email slot.
    const email = "soft-deleted@example.com";
    const tdb = createTenantDb(testDb.db, SYSTEM_TENANT_ID, "system");
    const systemUser = createSystemUser(SYSTEM_TENANT_ID);

    const created = await executor.create(
      { email, displayName: "Departing User" },
      systemUser,
      tdb,
    );
    if (!created.isSuccess) throw new Error("expected create to succeed");

    const deleted = await executor.delete({ id: created.data.id }, systemUser, tdb);
    if (!deleted.isSuccess) throw new Error("expected soft-delete to succeed");

    const reCreated = await executor.create({ email, displayName: "Squatter" }, systemUser, tdb);
    if (reCreated.isSuccess) {
      throw new Error("expected re-create with the same email to be rejected while soft-deleted");
    }
    expect(reCreated.error.code).toBe("unique_violation");
    const details = reCreated.error.details as { constraintName?: string };
    expect(details.constraintName).toBe("read_users_email_unique_bidx");
  });
});
