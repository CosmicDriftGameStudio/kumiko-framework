// Full-stack proof for EntityDefinition.derivedFields: a derived field is
// computed read-time by the list-query handler and appended to each row — it
// has no DB column, is never written, and the clock comes from ctx.asOf.
//
// Bun.SQL-only setup via setupTestStack.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, selectMany } from "../db/query";
import { buildEntityTable } from "../db/table-builder";
import {
  createDerivedField,
  createEntity,
  createNumberField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityListHandler,
  defineFeature,
} from "../engine";
import { setupTestStack, type TestStack, TestUsers, unsafeCreateEntityTable } from "../stack";

// `priceCents` + `name` are stored; the three derived fields are computed from
// them (and the clock) at read-time only.
const gadgetEntity = createEntity({
  table: "derived_gadgets",
  fields: {
    name: createTextField({ required: true }),
    priceCents: createNumberField({ required: true }),
  },
  derivedFields: {
    // Pure row→value: the canonical "one live-computed column" case.
    grossCents: createDerivedField({
      valueType: "number",
      derive: (row) => Math.round(Number(row["priceCents"]) * 1.19),
    }),
    label: createDerivedField({
      valueType: "text",
      derive: (row) => `${String(row["name"])} (${String(row["priceCents"])})`,
    }),
    // Proves the clock is injected — never reads Temporal.Now itself.
    asOfStamp: createDerivedField({
      valueType: "text",
      derive: (_row, ctx) => ctx.asOf.toString(),
    }),
  },
});
const gadgetTable = buildEntityTable("gadget", gadgetEntity);

const shopFeature = defineFeature("gadgetshop", (r) => {
  r.entity("gadget", gadgetEntity);
  r.writeHandler(
    defineEntityCreateHandler("gadget", gadgetEntity, { access: { roles: ["Admin"] } }),
  );
  r.queryHandler(defineEntityListHandler("gadget", gadgetEntity, { access: { roles: ["Admin"] } }));
});

describe("EntityDefinition.derivedFields — read-time computed columns", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [shopFeature] });
    await unsafeCreateEntityTable(stack.db, gadgetEntity);
  });

  afterAll(() => stack.cleanup());

  beforeEach(async () => {
    await asRawClient(stack.db).unsafe(`DELETE FROM "${gadgetTable.tableName}"`);
  });

  test("list query appends the computed value (gross = net × 1.19)", async () => {
    await stack.http.writeOk(
      "gadgetshop:write:gadget:create",
      { name: "Cable", priceCents: 1000 },
      TestUsers.admin,
    );
    await stack.http.writeOk(
      "gadgetshop:write:gadget:create",
      { name: "Hub", priceCents: 4200 },
      TestUsers.admin,
    );

    const res = await stack.http.query("gadgetshop:query:gadget:list", {}, TestUsers.admin);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { rows: Array<Record<string, unknown>> };
    };
    const byName = new Map(body.data.rows.map((r) => [r["name"], r]));

    expect(byName.get("Cable")?.["grossCents"]).toBe(1190);
    expect(byName.get("Hub")?.["grossCents"]).toBe(4998);
    expect(byName.get("Cable")?.["label"]).toBe("Cable (1000)");
  });

  test("derived value comes from ctx.asOf, parseable as an instant", async () => {
    await stack.http.writeOk(
      "gadgetshop:write:gadget:create",
      { name: "Cable", priceCents: 1000 },
      TestUsers.admin,
    );

    const res = await stack.http.query("gadgetshop:query:gadget:list", {}, TestUsers.admin);
    const body = (await res.json()) as { data: { rows: Array<Record<string, unknown>> } };
    const stamp = body.data.rows[0]?.["asOfStamp"];

    expect(typeof stamp).toBe("string");
    // A real read-time instant — Temporal parses it and it's within a minute.
    const parsed = Temporal.Instant.from(String(stamp));
    const skewSeconds = Math.abs(parsed.until(Temporal.Now.instant()).total("seconds"));
    expect(skewSeconds).toBeLessThan(60);
  });

  test("derived fields produce no DB column — the stored row has only name + priceCents", async () => {
    await stack.http.writeOk(
      "gadgetshop:write:gadget:create",
      { name: "Cable", priceCents: 1000 },
      TestUsers.admin,
    );

    const rows = await selectMany(stack.db, gadgetTable);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("grossCents");
    expect(rows[0]).not.toHaveProperty("label");
    expect(rows[0]).not.toHaveProperty("asOfStamp");
    expect(rows[0]?.["name"]).toBe("Cable");
  });
});
