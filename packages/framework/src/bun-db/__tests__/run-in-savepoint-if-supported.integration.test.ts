// fw#… dead-tx-in-afterCommit-hooks: runInSavepointIfSupported must fail
// loudly on a transaction handle that has already committed, instead of
// silently re-running `fn` outside the savepoint's isolation. Uses a real
// Postgres connection — a mock handle can't produce the driver's actual
// PG 25P01 ("no active sql transaction") on a post-commit savepoint call.

import { afterAll, describe, expect, test } from "bun:test";
import { InternalError } from "../../errors";
import { asRawClient, runInSavepointIfSupported } from "../query";
import { closeDb, getDb } from "./_helpers";

afterAll(async () => {
  await closeDb();
});

describe("runInSavepointIfSupported — already-committed transaction", () => {
  test("throws InternalError naming afterCommit + dbOutsideTransaction, never runs fn", async () => {
    const db = await getDb();
    const raw = asRawClient(db);

    let committedTx: unknown;
    await raw.begin(async (tx) => {
      committedTx = tx;
    });
    // `committedTx` is now a driver handle whose transaction has committed —
    // it still exposes `.savepoint()`, calling it fails with PG 25P01.

    let fnCalls = 0;
    const fn = async () => {
      fnCalls++;
      return "should-not-run";
    };

    let caught: unknown;
    try {
      await runInSavepointIfSupported(committedTx, fn);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(InternalError);
    const message = (caught as Error).message;
    expect(message).toContain("afterCommit");
    expect(message).toContain("dbOutsideTransaction");
    expect(fnCalls).toBe(0);
  });
});
