// The member read runs in a savepoint that is always discarded; it must hand back
// the callback's value (including undefined), keep writes out, and leave the outer tx writable.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DbTx } from "../../db/connection.js";
import { asRawClient } from "../../db/query.js";
import { AccessDeniedError, MemberReadTimeoutError } from "../../errors/index.js";
import { createTestDb, type TestDb } from "../../stack/index.js";
import type { DispatchContext } from "../dispatch-shared.js";
import { runInMemberReadOnlyTransaction } from "../member-read-only-transaction.js";

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  await asRawClient(testDb.db).unsafe(
    "CREATE TABLE member_ro_probe (id integer PRIMARY KEY, note text)",
  );
});

afterAll(async () => {
  await testDb.cleanup();
});

const dispatchContext = (memberReadTimeoutMs = 10_000): DispatchContext =>
  // @cast-boundary test-fixture — the read-only runner only reads appContext.db and memberReadTimeoutMs from the dispatch context
  ({ appContext: { db: testDb.db }, memberReadTimeoutMs }) as unknown as DispatchContext;

describe("runInMemberReadOnlyTransaction", () => {
  test("pool path returns the callback value, undefined included", async () => {
    const value = await runInMemberReadOnlyTransaction(dispatchContext(), undefined, async (tx) => {
      const rows = await asRawClient(tx).unsafe<{ n: number }>("SELECT 7 AS n");
      return rows[0]?.n;
    });
    expect(value).toBe(7);
    expect(
      await runInMemberReadOnlyTransaction(dispatchContext(), undefined, async () => undefined),
    ).toBeUndefined();
  });

  test("a write inside the member read is denied and nothing persists", async () => {
    const attempt = runInMemberReadOnlyTransaction(dispatchContext(), undefined, async (tx) => {
      await asRawClient(tx).unsafe("INSERT INTO member_ro_probe (id, note) VALUES (1, 'x')");
    });
    await expect(attempt).rejects.toBeInstanceOf(AccessDeniedError);
    const rows = await asRawClient(testDb.db).unsafe("SELECT id FROM member_ro_probe");
    expect(rows.length).toBe(0);
  });

  test("inside an outer tx the savepoint is discarded, so the outer tx stays writable", async () => {
    await testDb.db.begin(async (outer: DbTx) => {
      const value = await runInMemberReadOnlyTransaction(dispatchContext(), outer, async () => 42);
      expect(value).toBe(42);
      await asRawClient(outer).unsafe("INSERT INTO member_ro_probe (id, note) VALUES (2, 'y')");
    });
    const rows = await asRawClient(testDb.db).unsafe("SELECT id FROM member_ro_probe");
    expect(rows.length).toBe(1);
  });

  test("pool path: a read past the statement timeout fails with member_read_timeout", async () => {
    const attempt = runInMemberReadOnlyTransaction(dispatchContext(50), undefined, async (tx) => {
      await asRawClient(tx).unsafe("SELECT pg_sleep(2)");
    });
    await expect(attempt).rejects.toBeInstanceOf(MemberReadTimeoutError);
    await expect(attempt).rejects.toMatchObject({ code: "member_read_timeout" });
  });

  test("outer-tx path: a read past the statement timeout fails with member_read_timeout", async () => {
    const attempt = testDb.db.begin(async (outer: DbTx) =>
      runInMemberReadOnlyTransaction(dispatchContext(50), outer, async (tx) => {
        await asRawClient(tx).unsafe("SELECT pg_sleep(2)");
      }),
    );
    await expect(attempt).rejects.toBeInstanceOf(MemberReadTimeoutError);
  });

  test("the timeout settings do not leak: a later statement in the outer tx is not time-limited", async () => {
    await testDb.db.begin(async (outer: DbTx) => {
      await runInMemberReadOnlyTransaction(dispatchContext(50), outer, async () => 1);
      const rows = await asRawClient(outer).unsafe<{ setting: string }>(
        "SELECT current_setting('statement_timeout') AS setting",
      );
      expect(rows[0]?.setting).not.toBe("50ms");
    });
  });
});
