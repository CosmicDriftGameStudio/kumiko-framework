// field-access.ts, quota.ts and user-data-rights.ts read custom-field rows
// through unsafeReadRetrying; this proves the retry fires per call site using
// a real captured driver error.

import { beforeAll, describe, expect, test } from "bun:test";
import {
  captureClosedConnectionError,
  fakePooledClientFailingWith,
} from "@cosmicdrift/kumiko-testing/helpers";
import { selectSerializedFieldDefinition } from "../field-access.ts";
import { countTenantFieldDefinitions } from "../quota.ts";
import { selectCustomFieldsHostRows } from "../user-data-rights.ts";

let closedConnectionError: unknown;

beforeAll(async () => {
  closedConnectionError = await captureClosedConnectionError();
});

describe("custom-fields db/queries — closed-connection retry", () => {
  test("selectSerializedFieldDefinition retries once and returns the row", async () => {
    const raw = fakePooledClientFailingWith([closedConnectionError], { serialized_field: "sf1" });
    const result = await selectSerializedFieldDefinition(raw, "t1", "entity", "field");
    expect(result).toBe("sf1");
    expect(raw.calls).toHaveLength(2);
  });

  test("countTenantFieldDefinitions retries once and returns the count", async () => {
    const raw = fakePooledClientFailingWith([closedConnectionError], { n: 3 });
    const result = await countTenantFieldDefinitions(raw, "t1");
    expect(result).toBe(3);
    expect(raw.calls).toHaveLength(2);
  });

  test("selectCustomFieldsHostRows retries once and returns rows", async () => {
    const db = fakePooledClientFailingWith([closedConnectionError], { id: "1", custom_fields: {} });
    const rows = await selectCustomFieldsHostRows(db, "host_table", "user_id", "u1", "t1");
    expect(rows).toHaveLength(1);
    expect(db.calls).toHaveLength(2);
  });
});
