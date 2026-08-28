// fw#2490: `multiSelect` fields accept `filterable: true` at boot but the
// executor's screen-filter WHERE builder only ever emitted scalar equality
// (`col = $1`) against the jsonb-array column — Postgres rejects that as
// "operator does not exist: jsonb = text" the first time a filter actually
// runs. This proves the fix over real HTTP: eq/ne/in on a filterable
// multiSelect field must use jsonb containment (`@>`), not scalar equality.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { deriveEntityTableMeta } from "../../db/entity-table-meta";
import { asRawClient, selectMany } from "../../db/query";
import { setupTestStack, type TestStack, TestUsers, unsafeCreateEntityTable } from "../../stack";
import { defineFeature } from "../define-feature";
import { createEntity, createMultiSelectField, createTextField } from "../factories";

const equipmentEntity = createEntity({
  table: "ms_filter_equipment",
  fields: {
    name: createTextField({ required: true }),
    tags: createMultiSelectField({
      options: ["vip", "urgent", "loaner"] as const,
      filterable: true,
    }),
  },
});

const LIST_QN = "checklist:query:equipment:list";

const checklistFeature = defineFeature("checklist", (r) => {
  r.crud("equipment", equipmentEntity, {
    write: { access: { roles: ["Admin"] } },
    read: { access: { openToAll: true } },
  });
});

describe("multiSelect filterable — jsonb containment, not scalar equality (fw#2490)", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [checklistFeature] });
    await unsafeCreateEntityTable(stack.db, equipmentEntity);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
    await asRawClient(stack.db).unsafe('DELETE FROM "ms_filter_equipment"');
  });

  async function seed(): Promise<void> {
    const CREATE = "checklist:write:equipment:create";
    await stack.http.write(CREATE, { name: "Drill", tags: ["vip", "urgent"] }, TestUsers.admin);
    await stack.http.write(CREATE, { name: "Ladder", tags: ["loaner"] }, TestUsers.admin);
    await stack.http.write(CREATE, { name: "Saw", tags: [] }, TestUsers.admin);
  }

  test("op:eq on a multiSelect field returns rows whose array contains the value", async () => {
    await seed();
    const result = await stack.http.queryOk<{
      readonly rows: readonly { readonly name: string; readonly tags: readonly string[] }[];
    }>(LIST_QN, { limit: 50, filter: { field: "tags", op: "eq", value: "vip" } }, TestUsers.admin);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.name).toBe("Drill");
  });

  test("op:eq with an array value returns rows whose array contains all listed values", async () => {
    await seed();
    const result = await stack.http.queryOk<{
      readonly rows: readonly { readonly name: string }[];
    }>(
      LIST_QN,
      { limit: 50, filter: { field: "tags", op: "eq", value: ["vip", "urgent"] } },
      TestUsers.admin,
    );

    expect(result.rows.map((r) => r.name)).toEqual(["Drill"]);
  });

  test("op:ne on a multiSelect field returns rows whose array does not contain the value", async () => {
    await seed();
    const result = await stack.http.queryOk<{
      readonly rows: readonly { readonly name: string }[];
    }>(LIST_QN, { limit: 50, filter: { field: "tags", op: "ne", value: "vip" } }, TestUsers.admin);

    expect(result.rows.map((r) => r.name).sort()).toEqual(["Ladder", "Saw"]);
  });

  test("op:in on a multiSelect field returns rows whose array contains any listed value", async () => {
    await seed();
    const result = await stack.http.queryOk<{
      readonly rows: readonly { readonly name: string }[];
    }>(
      LIST_QN,
      { limit: 50, filters: [{ field: "tags", op: "in", value: ["urgent", "loaner"] }] },
      TestUsers.admin,
    );

    expect(result.rows.map((r) => r.name).sort()).toEqual(["Drill", "Ladder"]);
  });

  test("op:lt on a multiSelect field is unsatisfiable — empty result, no crash", async () => {
    await seed();
    const result = await stack.http.queryOk<{
      readonly rows: readonly { readonly name: string }[];
    }>(LIST_QN, { limit: 50, filter: { field: "tags", op: "lt", value: "vip" } }, TestUsers.admin);

    expect(result.rows).toHaveLength(0);
  });

  // The issue's own diagnosis (fw#2490) points at buildWhereClause in
  // bun-db/query.ts, not the screen-filter path above — that generic query
  // API is what direct app/handler code hits when it filters a multiSelect
  // column without going through a screen filter. Same jsonb-array bug,
  // separate WHERE-builder, must be covered independently.
  describe("generic selectMany() query API (bun-db/query.ts buildWhereClause)", () => {
    const meta = deriveEntityTableMeta("equipment", equipmentEntity);

    test("scalar equality uses jsonb containment, not `=`", async () => {
      await seed();
      const rows = await selectMany<{ name: string }>(stack.db, meta, { tags: "vip" });
      expect(rows.map((r) => r.name).sort()).toEqual(["Drill"]);
    });

    test("`ne` returns rows whose array does not contain the value", async () => {
      await seed();
      const rows = await selectMany<{ name: string }>(stack.db, meta, { tags: { ne: "vip" } });
      expect(rows.map((r) => r.name).sort()).toEqual(["Ladder", "Saw"]);
    });

    test("`in` returns rows whose array contains any listed value", async () => {
      await seed();
      const rows = await selectMany<{ name: string }>(stack.db, meta, {
        tags: { in: ["urgent", "loaner"] },
      });
      expect(rows.map((r) => r.name).sort()).toEqual(["Drill", "Ladder"]);
    });
  });
});
