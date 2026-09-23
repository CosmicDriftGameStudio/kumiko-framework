// field-access.ts, quota.ts, user-data-rights.ts and retention.ts read
// custom-field rows through unsafeReadRetrying; this proves the retry fires
// per call site using a real captured driver error. applyRetentionRemovals
// (an UPDATE) stays out of scope — unretried by design.

import { beforeAll, describe, expect, test } from "bun:test";
import { captureClosedConnectionError } from "@cosmicdrift/kumiko-framework/testing";
import { selectSerializedFieldDefinition } from "../field-access";
import { countTenantFieldDefinitions } from "../quota";
import { selectHostRowsWithCustomFields } from "../retention";
import { selectCustomFieldsHostRows, selectFieldDefinitionsForEntity } from "../user-data-rights";

let closedConnectionError: unknown;

beforeAll(async () => {
  closedConnectionError = await captureClosedConnectionError();
});

type FakeClient = {
  unsafe: (sql: string, params?: readonly unknown[]) => Promise<readonly unknown[]>;
  begin: () => never;
  options: { max: number };
  calls: number;
};

function fakeClient(failures: unknown[], row: Record<string, unknown>): FakeClient {
  const remaining = [...failures];
  const client: FakeClient = {
    calls: 0,
    options: { max: 1 },
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

describe("custom-fields db/queries — closed-connection retry", () => {
  test("selectSerializedFieldDefinition retries once through db.unsafeRaw and returns the row", async () => {
    const raw = fakeClient([closedConnectionError], { serialized_field: "sf1" });
    const result = await selectSerializedFieldDefinition(raw, "t1", "entity", "field");
    expect(result).toBe("sf1");
    expect(raw.calls).toBe(2);
  });

  test("countTenantFieldDefinitions retries once through db.unsafeRaw and returns the count", async () => {
    const raw = fakeClient([closedConnectionError], { n: 3 });
    const result = await countTenantFieldDefinitions(raw, "t1");
    expect(result).toBe(3);
    expect(raw.calls).toBe(2);
  });

  test("selectCustomFieldsHostRows retries once and returns rows", async () => {
    const db = fakeClient([closedConnectionError], { id: "1", custom_fields: {} });
    const rows = await selectCustomFieldsHostRows(db as never, "host_table", "user_id", "u1", "t1");
    expect(rows).toHaveLength(1);
    expect(db.calls).toBe(2);
  });

  test("selectFieldDefinitionsForEntity retries once and returns rows", async () => {
    const db = fakeClient([closedConnectionError], { field_key: "k1", serialized_field: "sf" });
    const rows = await selectFieldDefinitionsForEntity(db as never, "entity", "t1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.field_key).toBe("k1");
    expect(db.calls).toBe(2);
  });

  test("selectHostRowsWithCustomFields retries once and returns rows", async () => {
    const db = fakeClient([closedConnectionError], {
      id: "1",
      modified_at: null,
      custom_fields: {},
    });
    const rows = await selectHostRowsWithCustomFields(db as never, "host_table", "t1");
    expect(rows).toHaveLength(1);
    expect(db.calls).toBe(2);
  });

  test("gives up after exhausting pool-bounded retries (max: 1 → 3 total calls)", async () => {
    const raw = fakeClient([closedConnectionError, closedConnectionError, closedConnectionError], {
      serialized_field: "sf1",
    });
    await expect(selectSerializedFieldDefinition(raw, "t1", "entity", "field")).rejects.toBe(
      closedConnectionError,
    );
    expect(raw.calls).toBe(3);
  });
});
