// #2323: field-access.ts, quota.ts, user-data-rights.ts and retention.ts read
// custom-field rows via asRawClient(db).unsafe() directly, bypassing the
// #1163 closed-connection retry that only covered bun-db/query.ts's own
// selectMany/countWhere. Routed the SELECT-only call sites through
// unsafeReadRetrying instead — this test mirrors
// bun-db/__tests__/select-many-retry.test.ts's fake-client pattern to prove
// the retry now actually fires for each call site. applyRetentionRemovals
// (an UPDATE) is out of scope per #1358 — writes stay unretried.

import { describe, expect, test } from "bun:test";
import { selectSerializedFieldDefinition } from "../field-access";
import { countTenantFieldDefinitions } from "../quota";
import { selectHostRowsWithCustomFields } from "../retention";
import { selectCustomFieldsHostRows, selectFieldDefinitionsForEntity } from "../user-data-rights";

function closedConnectionError(): Error {
  return Object.assign(new Error("The connection was closed."), { name: "AbortError" });
}

type FakeClient = {
  unsafe: (sql: string, params?: readonly unknown[]) => Promise<readonly unknown[]>;
  begin: () => never;
  calls: number;
};

function fakeClient(failures: Error[], row: Record<string, unknown>): FakeClient {
  const remaining = [...failures];
  const client: FakeClient = {
    calls: 0,
    unsafe: async () => {
      client.calls++;
      const err = remaining.shift();
      if (err) throw err;
      return [row];
    },
    begin: () => {
      throw new Error("not used in test");
    },
  };
  return client;
}

describe("custom-fields db/queries — closed-connection retry (#2323)", () => {
  test("selectSerializedFieldDefinition retries once through db.raw and returns the row", async () => {
    const raw = fakeClient([closedConnectionError()], { serialized_field: "sf1" });
    const result = await selectSerializedFieldDefinition({ raw } as never, "t1", "entity", "field");
    expect(result).toBe("sf1");
    expect(raw.calls).toBe(2);
  });

  test("countTenantFieldDefinitions retries once through db.raw and returns the count", async () => {
    const raw = fakeClient([closedConnectionError()], { n: 3 });
    const result = await countTenantFieldDefinitions({ raw } as never, "t1");
    expect(result).toBe(3);
    expect(raw.calls).toBe(2);
  });

  test("selectCustomFieldsHostRows retries once and returns rows", async () => {
    const db = fakeClient([closedConnectionError()], { id: "1", custom_fields: {} });
    const rows = await selectCustomFieldsHostRows(db as never, "host_table", "user_id", "u1", "t1");
    expect(rows).toHaveLength(1);
    expect(db.calls).toBe(2);
  });

  test("selectFieldDefinitionsForEntity retries once and returns rows", async () => {
    const db = fakeClient([closedConnectionError()], { field_key: "k1", serialized_field: "sf" });
    const rows = await selectFieldDefinitionsForEntity(db as never, "entity", "t1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.field_key).toBe("k1");
    expect(db.calls).toBe(2);
  });

  test("selectHostRowsWithCustomFields retries once and returns rows", async () => {
    const db = fakeClient([closedConnectionError()], {
      id: "1",
      modified_at: null,
      custom_fields: {},
    });
    const rows = await selectHostRowsWithCustomFields(db as never, "host_table", "t1");
    expect(rows).toHaveLength(1);
    expect(db.calls).toBe(2);
  });

  test("gives up after the single retry when the connection stays closed", async () => {
    const raw = fakeClient([closedConnectionError(), closedConnectionError()], {
      serialized_field: "sf1",
    });
    await expect(
      selectSerializedFieldDefinition({ raw } as never, "t1", "entity", "field"),
    ).rejects.toThrow("connection was closed");
    expect(raw.calls).toBe(2);
  });
});
