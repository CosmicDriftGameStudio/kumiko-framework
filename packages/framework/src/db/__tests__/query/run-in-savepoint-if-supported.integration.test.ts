// dead-tx-in-afterCommit-hooks: runInSavepointIfSupported must fail
// loudly on a transaction handle that has already committed, instead of
// silently re-running `fn` outside the savepoint's isolation. Uses a real
// Postgres connection — a mock handle can't produce the driver's actual
// ERR_POSTGRES_INVALID_TRANSACTION_STATE on a post-commit savepoint call.

import { afterAll, describe, expect, test } from "bun:test";
import { InternalError } from "../../../errors/index.ts";
import { runInSavepointIfSupported, transaction } from "../../query.ts";
import { closeDb, getDb } from "./_helpers.ts";

afterAll(async () => {
  await closeDb();
});

describe("runInSavepointIfSupported — already-committed transaction", () => {
  test("throws InternalError naming afterCommit + db.outsideTransaction, never runs fn", async () => {
    const db = await getDb();

    let committedTx: unknown;
    await transaction(db, async (tx) => {
      committedTx = tx;
    });
    // `committedTx` is now a driver handle whose transaction has committed —
    // it still exposes `.savepoint()`, calling it fails with ERR_POSTGRES_INVALID_TRANSACTION_STATE.

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
    expect(message).toContain("db.outsideTransaction");
    expect(fnCalls).toBe(0);
  });

  test("an error thrown inside fn is not remapped, even with a closed-connection code", async () => {
    const db = await getDb();
    const original = Object.assign(new Error("Connection closed"), {
      code: "ERR_POSTGRES_CONNECTION_CLOSED",
    });

    let caught: unknown;
    await transaction(db, async (tx) => {
      try {
        await runInSavepointIfSupported(tx, async () => {
          throw original;
        });
      } catch (e) {
        caught = e;
      }
    });

    expect(caught).toBe(original);
  });
});
