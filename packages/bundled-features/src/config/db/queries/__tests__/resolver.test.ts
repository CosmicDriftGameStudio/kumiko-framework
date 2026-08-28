import { describe, expect, test } from "bun:test";
import { selectConfigRowsForKeys, selectConfigRowsForScope } from "../resolver";

function closedConnectionError(): Error {
  return Object.assign(new Error("The connection was closed."), { name: "AbortError" });
}

type FakeClient = {
  unsafe: (sql: string, params?: readonly unknown[]) => Promise<readonly unknown[]>;
  begin: () => never;
  calls: number;
};

function fakeClient(failures: Error[]): FakeClient {
  const remaining = [...failures];
  const client: FakeClient = {
    calls: 0,
    unsafe: async () => {
      client.calls++;
      const err = remaining.shift();
      if (err) throw err;
      return [{ id: "r1", key: "k", value: "v", tenantId: "t1", userId: null }];
    },
    // begin() present => pool client => retry path
    begin: () => {
      throw new Error("not used in test");
    },
  };
  return client;
}

describe("config db/queries/resolver — closed-connection retry (#1163)", () => {
  test("selectConfigRowsForScope retries once and returns rows", async () => {
    const db = fakeClient([closedConnectionError()]);
    const rows = await selectConfigRowsForScope(db as never, "system", "t1", "u1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe("k");
    expect(db.calls).toBe(2);
  });

  test("selectConfigRowsForKeys retries once and returns rows", async () => {
    const db = fakeClient([closedConnectionError()]);
    const rows = await selectConfigRowsForKeys(db as never, ["k"], "system", "t1", "u1");
    expect(rows).toHaveLength(1);
    expect(db.calls).toBe(2);
  });

  test("gives up after the single retry when the connection stays closed", async () => {
    const db = fakeClient([closedConnectionError(), closedConnectionError()]);
    await expect(selectConfigRowsForScope(db as never, "system", "t1", "u1")).rejects.toThrow(
      "connection was closed",
    );
    expect(db.calls).toBe(2);
  });

  test("does not retry when the client has no begin()", async () => {
    let calls = 0;
    const db = {
      unsafe: async () => {
        calls++;
        throw closedConnectionError();
      },
      savepoint: () => {
        throw new Error("not used");
      },
    };
    await expect(selectConfigRowsForScope(db as never, "system", "t1", "u1")).rejects.toThrow(
      "connection was closed",
    );
    expect(calls).toBe(1);
  });
});
