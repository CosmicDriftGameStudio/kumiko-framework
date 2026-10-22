import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { asRawClient } from "../../../db/query.ts";
import { TestUsers } from "../../../seeding/seed-users.ts";
import {
  CREATE_CUSTOMER,
  CREATE_ITEM,
  customerEntity,
  exportFeature,
  itemEntity,
  LIST_SCREEN,
} from "./export-xlsx-fixture.ts";
import { readXlsx } from "./read-xlsx.ts";

const MISSING_CUSTOMER = "00000000-0000-4000-8000-0000000000aa";

describe("POST /api/export/xlsx: reference labels and time zones", () => {
  let stack: TestStack;
  const admin = TestUsers.admin;

  beforeAll(async () => {
    stack = await setupTestStack({
      features: [exportFeature],
      authConfig: { membershipQuery: "xl:query:nonexistent" },
    });
    await unsafeCreateEntityTable(stack.db, customerEntity);
    await unsafeCreateEntityTable(stack.db, itemEntity);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  beforeEach(async () => {
    await asRawClient(stack.db).unsafe("DELETE FROM kumiko_events");
    await asRawClient(stack.db).unsafe('DELETE FROM "xl_items"');
    await asRawClient(stack.db).unsafe('DELETE FROM "xl_customers"');
  });

  async function createCustomer(name: string): Promise<string> {
    const created = await stack.http.writeOk<{ id: string }>(CREATE_CUSTOMER, { name }, admin);
    return created.id;
  }

  async function createItem(fields: Record<string, unknown>) {
    await stack.http.writeOk(
      CREATE_ITEM,
      {
        title: "item",
        qty: 1,
        amount: { amount: 1, currency: "EUR" },
        dueOn: "2026-03-05",
        placedAt: "2026-03-05T13:30:00.000Z",
        status: "open",
        active: true,
        vaultKey: "s3cret-value",
        ...fields,
      },
      admin,
    );
  }

  async function exportFirstRow(body: Record<string, unknown>) {
    const token = await stack.jwt.sign(admin);
    const res = await stack.http.raw(
      "POST",
      "/api/export/xlsx",
      { screen: LIST_SCREEN, ...body },
      { Authorization: `Bearer ${token}` },
    );
    expect(res.status).toBe(200);
    return readXlsx(await res.arrayBuffer()).rows[1] ?? [];
  }

  test("reference columns show the label of the target, joined for multiple references", async () => {
    const acme = await createCustomer("Acme");
    const globex = await createCustomer("Globex");
    await createItem({ customer: acme, contacts: [acme, globex] });
    const row = await exportFirstRow({ columns: ["customer", "contacts"] });
    expect(row[0]).toMatchObject({ t: "s", text: "Acme" });
    expect(row[1]).toMatchObject({ t: "s", text: "Acme, Globex" });
  });

  test("a reference whose target is missing shows the id", async () => {
    await createItem({ customer: MISSING_CUSTOMER });
    const row = await exportFirstRow({ columns: ["customer"] });
    expect(row[0]).toMatchObject({ t: "s", text: MISSING_CUSTOMER });
  });

  test("timestamps use the time zone of the request", async () => {
    await createItem({});
    const row = await exportFirstRow({ columns: ["placedAt"], timeZone: "Europe/Berlin" });
    expect(Number(row[0]?.raw)).toBeCloseTo(46086 + 14.5 / 24, 8);
  });

  test("an invalid time zone falls back to UTC", async () => {
    await createItem({});
    const row = await exportFirstRow({ columns: ["placedAt"], timeZone: "Not/AZone" });
    expect(row[0]).toMatchObject({ raw: "46086.5625" });
  });
});
