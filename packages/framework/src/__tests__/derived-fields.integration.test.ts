// Full-stack proof for EntityDefinition.derivedFields: a derived field is
// computed read-time by the list-query handler and appended to each row — it
// has no DB column, is never written, and the clock comes from the handler's ctx.tz.
//
// Bun.SQL-only setup via setupTestStack.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { selectMany } from "../db/query.ts";
import { buildEntityTable } from "../db/table-builder.ts";
import {
  createDerivedField,
  createEntity,
  createNumberField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityListHandler,
  defineFeature,
} from "../engine/index.ts";
import { eventsTable } from "../event-store/index.ts";
import { TestUsers } from "../seeding/seed-users.ts";

// `priceCents` + `name` are stored; the three derived fields are computed from
// them (and the clock) at read-time only.
const gadgetEntity = createEntity({
  table: "derived_gadgets",
  fields: {
    name: createTextField({ personal: false, reason: "test_fixture", required: true }),
    priceCents: createNumberField({ required: true }),
    nickname: createTextField({ personal: false, reason: "test_fixture" }),
    legacyName: createTextField({ personal: false, reason: "test_fixture" }),
  },
  derivedFields: {
    displayName: createDerivedField({
      valueType: "text",
      sortable: true,
      sql: { kind: "coalesce", fields: ["nickname", "legacyName"] },
    }),
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
    // A JS derive runs after the SQL derived values are on the row.
    shownAs: createDerivedField({
      valueType: "text",
      derive: (row) => `[${String(row["displayName"])}]`,
    }),
  },
});
const gadgetTable = buildEntityTable("gadget", gadgetEntity);

const shopFeature = defineFeature("gadgetshop", (r) => {
  r.entity({ name: "gadget", ...gadgetEntity });
  r.writeHandler(
    defineEntityCreateHandler("gadget", gadgetEntity, { access: { roles: ["Admin"] } }),
  );
  r.queryHandler(defineEntityListHandler("gadget", gadgetEntity, { access: { roles: ["Admin"] } }));
});

describe("EntityDefinition.derivedFields — read-time computed columns", () => {
  let stack: TestStack;
  let readInstant = Temporal.Instant.from("2026-03-01T08:00:00Z");

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [shopFeature],
      extraContext: { clock: { now: () => readInstant } },
    });
    await unsafeCreateEntityTable(stack.db, gadgetEntity);
  });

  afterAll(() => stack.cleanup());

  beforeEach(async () => {
    await resetTestTables(stack.db, [gadgetTable, eventsTable]);
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

  test("derived value comes from the injected clock", async () => {
    await stack.http.writeOk(
      "gadgetshop:write:gadget:create",
      { name: "Cable", priceCents: 1000 },
      TestUsers.admin,
    );
    const stampAt = async (iso: string): Promise<unknown> => {
      readInstant = Temporal.Instant.from(iso);
      const res = await stack.http.query("gadgetshop:query:gadget:list", {}, TestUsers.admin);
      const body = (await res.json()) as { data: { rows: Array<Record<string, unknown>> } };
      return body.data.rows[0]?.["asOfStamp"];
    };

    expect(await stampAt("2026-03-01T08:00:00Z")).toBe("2026-03-01T08:00:00Z");
    expect(await stampAt("2027-01-02T03:04:05Z")).toBe("2027-01-02T03:04:05Z");
  });

  test("sql coalesce column: value, JS derive reads it, sort asc/desc with NULLs", async () => {
    const gadgets = [
      { name: "a", priceCents: 1, legacyName: "Alpha" },
      { name: "b", priceCents: 1, nickname: "Zed" },
      { name: "c", priceCents: 1 },
      { name: "d", priceCents: 1, legacyName: "Delta" },
    ];
    for (const gadget of gadgets) {
      await stack.http.writeOk("gadgetshop:write:gadget:create", gadget, TestUsers.admin);
    }
    const namesSorted = async (sortDirection: "asc" | "desc"): Promise<unknown[]> => {
      const res = await stack.http.query(
        "gadgetshop:query:gadget:list",
        { sort: "displayName", sortDirection },
        TestUsers.admin,
      );
      const body = (await res.json()) as { data: { rows: Array<Record<string, unknown>> } };
      return body.data.rows.map((row) => row["name"]);
    };

    expect(await namesSorted("asc")).toEqual(["a", "d", "b", "c"]);
    expect(await namesSorted("desc")).toEqual(["c", "b", "d", "a"]);

    const res = await stack.http.query("gadgetshop:query:gadget:list", {}, TestUsers.admin);
    const body = (await res.json()) as { data: { rows: Array<Record<string, unknown>> } };
    const byName = new Map(body.data.rows.map((row) => [row["name"], row]));
    expect(byName.get("b")?.["displayName"]).toBe("Zed");
    expect(byName.get("c")?.["displayName"]).toBeNull();
    expect(byName.get("a")?.["shownAs"]).toBe("[Alpha]");
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
    expect(rows[0]).not.toHaveProperty("displayName");
    expect(rows[0]?.["name"]).toBe("Cable");
  });
});
