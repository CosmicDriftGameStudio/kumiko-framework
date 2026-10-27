import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { asRawClient } from "../../db/query.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { defineFeature } from "../define-feature.ts";
import { createEntity, createJsonbField, createTextField } from "../factories.ts";

const decodeEntity = createEntity({
  table: "jsonb_empty_value_decodes",
  fields: {
    vin: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    candidates: createJsonbField({ emptyValue: "array", personal: false, reason: "test_fixture" }),
    extras: createJsonbField({ personal: false, reason: "test_fixture" }),
  },
});

const decodeFeature = defineFeature("jsonb-empty", (r) => {
  r.crud("decode", decodeEntity, {
    write: { access: { roles: ["User"] } },
    read: { access: { roles: ["User"] } },
  });
});

const CREATE = "jsonb-empty:write:decode:create";

describe('createJsonbField({ emptyValue: "array" })', () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [decodeFeature] });
    await unsafeCreateEntityTable(stack.db, decodeEntity);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  async function storedRow(id: string): Promise<Record<string, unknown> | undefined> {
    const rows = await asRawClient(stack.db).unsafe<Record<string, unknown>>(
      'SELECT candidates, extras FROM "jsonb_empty_value_decodes" WHERE id = $1',
      [id],
    );
    return rows[0];
  }

  test("a row that never wrote the field stores [] while the object default stays {}", async () => {
    const created = await stack.http.writeOk<{ data: { id: string } }>(
      CREATE,
      { vin: "VF3000" },
      TestUsers.user,
    );

    expect(await storedRow(created.data.id)).toEqual({ candidates: [], extras: {} });
  });

  test("an array round-trips", async () => {
    const created = await stack.http.writeOk<{ data: { id: string } }>(
      CREATE,
      { vin: "VF3001", candidates: ["3008", "5008"] },
      TestUsers.user,
    );

    expect((await storedRow(created.data.id))?.["candidates"]).toEqual(["3008", "5008"]);
  });

  test("an object is rejected for an array field", async () => {
    const res = await stack.http.write(
      CREATE,
      { vin: "VF3002", candidates: { first: "3008" } },
      TestUsers.user,
    );

    expect(res.status).toBe(400);
  });
});
