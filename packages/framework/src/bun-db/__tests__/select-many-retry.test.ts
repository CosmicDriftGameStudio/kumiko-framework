// #1163: Bun.SQL can hand out a closed connection under load (AbortError
// "The connection was closed."). Pure reads retry exactly once on a fresh
// pool checkout; tx handles, non-matching errors, and genuine user aborts
// must NOT retry.

import { describe, expect, test } from "bun:test";
import { buildEntityTable } from "../../db/table-builder";
import { selectMany } from "../query";

function closedConnectionError(): Error {
  return Object.assign(new Error("The connection was closed."), { name: "AbortError" });
}

type FakeClient = {
  unsafe: (sql: string, params?: readonly unknown[]) => Promise<readonly unknown[]>;
  begin?: () => never;
  calls: number;
};

function fakeClient(failures: Error[], opts: { tx?: boolean } = {}): FakeClient {
  const remaining = [...failures];
  const client: FakeClient = {
    calls: 0,
    unsafe: async () => {
      client.calls++;
      const err = remaining.shift();
      if (err) throw err;
      return [{ id: "r1", title: "ok", tenant_id: "t1", inserted_at: null, updated_at: null }];
    },
  };
  // A top-level pool client has begin(); a transaction handle does not.
  if (!opts.tx) client.begin = () => { throw new Error("not used in test"); };
  return client;
}

const table = buildEntityTable("note", {
  fields: { title: { type: "text", required: true } },
});

describe("selectMany — closed-connection retry (#1163)", () => {
  test("retries once on AbortError 'connection was closed' and returns rows", async () => {
    const db = fakeClient([closedConnectionError()]);
    const rows = await selectMany(db, table);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("ok");
    expect(db.calls).toBe(2);
  });

  test("gives up after the single retry when the connection stays closed", async () => {
    const db = fakeClient([closedConnectionError(), closedConnectionError()]);
    await expect(selectMany(db, table)).rejects.toThrow("connection was closed");
    expect(db.calls).toBe(2);
  });

  test("never retries on a transaction handle (no begin)", async () => {
    const db = fakeClient([closedConnectionError()], { tx: true });
    await expect(selectMany(db, table)).rejects.toThrow("connection was closed");
    expect(db.calls).toBe(1);
  });

  test("does not retry a genuine user abort (different message)", async () => {
    const userAbort = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    const db = fakeClient([userAbort]);
    await expect(selectMany(db, table)).rejects.toThrow("operation was aborted");
    expect(db.calls).toBe(1);
  });

  test("does not retry generic query errors", async () => {
    const syntax = Object.assign(new Error("syntax error at or near"), { name: "PostgresError" });
    const db = fakeClient([syntax]);
    await expect(selectMany(db, table)).rejects.toThrow("syntax error");
    expect(db.calls).toBe(1);
  });
});
