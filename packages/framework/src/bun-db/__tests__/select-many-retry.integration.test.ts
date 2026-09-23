// selectMany retries a real captured closed-connection error, never a
// client abort or a transaction/reserved handle. Live-driver proof is in
// closed-connection-retry.integration.test.ts.

import { beforeAll, describe, expect, test } from "bun:test";
import { buildEntityTable } from "../../db/table-builder";
import { captureClosedConnectionError } from "../../testing/closed-connection-error";
import { selectMany } from "../query";

let closedConnectionError: unknown;

beforeAll(async () => {
  closedConnectionError = await captureClosedConnectionError();
});

type FakeClientOptions = {
  reserve?: boolean;
  begin?: boolean;
  savepoint?: boolean;
  release?: boolean;
};

type FakeClient = {
  unsafe: (sql: string, params?: readonly unknown[]) => Promise<readonly unknown[]>;
  begin?: () => never;
  savepoint?: () => never;
  release?: () => never;
  reserve?: () => never;
  options?: { max: number };
  calls: number;
};

function fakeClient(failures: unknown[], opts: FakeClientOptions = {}): FakeClient {
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
  const { begin = true, savepoint = false, release = false, reserve = true } = opts;
  if (begin) {
    client.begin = () => {
      throw new Error("not used in test");
    };
    client.options = { max: 1 };
  }
  if (savepoint)
    client.savepoint = () => {
      throw new Error("not used in test");
    };
  if (release)
    client.release = () => {
      throw new Error("not used in test");
    };
  if (reserve)
    client.reserve = () => {
      throw new Error("not used in test");
    };
  return client;
}

const table = buildEntityTable("note", {
  fields: { title: { type: "text", required: true } },
});

describe("selectMany — closed-connection retry", () => {
  test("retries once on a real closed-connection error and returns rows", async () => {
    const db = fakeClient([closedConnectionError]);
    const rows = await selectMany(db, table);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe("ok");
    expect(db.calls).toBe(2);
  });

  test("survives two dead connections in a row and returns rows", async () => {
    const db = fakeClient([closedConnectionError, closedConnectionError]);
    const rows = await selectMany(db, table);
    expect(rows).toHaveLength(1);
    expect(db.calls).toBe(3);
  });

  test("gives up after exhausting pool-bounded retries (max: 1 → 3 total calls)", async () => {
    const db = fakeClient([closedConnectionError, closedConnectionError, closedConnectionError]);
    await expect(selectMany(db, table)).rejects.toBe(closedConnectionError);
    expect(db.calls).toBe(3);
  });

  test("never retries on a transaction handle (savepoint, no begin)", async () => {
    const db = fakeClient([closedConnectionError], {
      begin: false,
      savepoint: true,
      reserve: false,
    });
    await expect(selectMany(db, table)).rejects.toBe(closedConnectionError);
    expect(db.calls).toBe(1);
  });

  test("never retries on a Bun.SQL-tx-shaped handle (begin + savepoint)", async () => {
    const db = fakeClient([closedConnectionError], {
      begin: true,
      savepoint: true,
      reserve: false,
    });
    await expect(selectMany(db, table)).rejects.toBe(closedConnectionError);
    expect(db.calls).toBe(1);
  });

  test("never retries on a reserved handle (begin + release)", async () => {
    const db = fakeClient([closedConnectionError], { begin: true, release: true, reserve: false });
    await expect(selectMany(db, table)).rejects.toBe(closedConnectionError);
    expect(db.calls).toBe(1);
  });

  test("does not retry a genuine user abort", async () => {
    const userAbort = new DOMException("The operation was aborted.", "AbortError");
    const db = fakeClient([userAbort]);
    await expect(selectMany(db, table)).rejects.toBe(userAbort);
    expect(db.calls).toBe(1);
  });

  test("does not retry a client abort whose message mentions a closed connection", async () => {
    const clientAbort = new DOMException("The connection was closed.", "AbortError");
    const db = fakeClient([clientAbort]);
    await expect(selectMany(db, table)).rejects.toBe(clientAbort);
    expect(db.calls).toBe(1);
  });

  test("does not retry generic query errors", async () => {
    const syntax = Object.assign(new Error("syntax error at or near"), { name: "PostgresError" });
    const db = fakeClient([syntax]);
    await expect(selectMany(db, table)).rejects.toThrow("syntax error");
    expect(db.calls).toBe(1);
  });
});
