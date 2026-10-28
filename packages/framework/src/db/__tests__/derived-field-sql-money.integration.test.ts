// A SQL derived money field (`related` + `first` on a money field) reads amount and currency
// together and lands on the row in the shape a stored money field has, so the same renderer draws it.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { seedRows } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createDateField,
  createDerivedField,
  createEntity,
  createMoneyField,
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import type { SessionUser } from "../../engine/types/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { buildEntityTable } from "../table-builder.ts";

const rentEntity = createEntity({
  table: "dsqm_rents",
  fields: {
    propertyId: { type: "reference", entity: "dsqm-property" },
    validFrom: createDateField({ required: true }),
    rent: createMoneyField({ required: true }),
    // Admin only: a User must get no derived money from it.
    secretRent: createMoneyField({ access: { read: { Admin: "all" } } }),
  },
  access: { read: { Admin: "all", User: "all" } },
});

const propertyEntity = createEntity({
  table: "dsqm_properties",
  fields: {
    name: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    storedRent: createMoneyField(),
  },
  derivedFields: {
    currentRent: createDerivedField({
      valueType: "money",
      sortable: true,
      sql: {
        kind: "related",
        entity: "dsqm-rent",
        on: { field: "propertyId" },
        measure: { kind: "first", field: "rent", orderBy: "validFrom", direction: "desc" },
      },
    }),
    currentSecretRent: createDerivedField({
      valueType: "money",
      sortable: true,
      sql: {
        kind: "related",
        entity: "dsqm-rent",
        on: { field: "propertyId" },
        measure: { kind: "first", field: "secretRent", orderBy: "validFrom", direction: "desc" },
      },
    }),
  },
});

const feature = defineFeature("dsqm", (r) => {
  const access = { roles: ["Admin", "User"] };
  r.crud("dsqm-rent", rentEntity, { write: { access }, read: { access } });
  r.crud("dsqm-property", propertyEntity, { write: { access }, read: { access } });
});

const LIST = "dsqm:query:dsqm-property:list";
const admin = TestUsers.admin;

const uid = (n: number): string =>
  `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const P1 = uid(1);
const P2 = uid(2);
const P3 = uid(3);
const P4 = uid(4);

type Page = { readonly rows: readonly Record<string, unknown>[] };

describe("SQL derived money field", () => {
  let stack: TestStack;
  const list = (payload: Record<string, unknown>, user: SessionUser = admin): Promise<Page> =>
    stack.http.queryOk<Page>(LIST, payload, user);
  const ids = (page: Page): unknown[] => page.rows.map((row) => row["id"]);
  const rowOf = (page: Page, id: string): Record<string, unknown> | undefined =>
    page.rows.find((row) => row["id"] === id);

  beforeAll(async () => {
    stack = await setupTestStack({ features: [feature] });
    await unsafeCreateEntityTable(stack.db, rentEntity, "dsqm-rent");
    await unsafeCreateEntityTable(stack.db, propertyEntity, "dsqm-property");

    const tenantId = admin.tenantId;
    await seedRows(stack.db, buildEntityTable("dsqm-property", propertyEntity), [
      { id: P1, tenantId, name: "Alpha", storedRent: 120050, storedRentCurrency: "EUR" },
      { id: P2, tenantId, name: "Beta", storedRent: 90000, storedRentCurrency: "CHF" },
      { id: P3, tenantId, name: "Gamma", storedRent: null, storedRentCurrency: "EUR" },
      { id: P4, tenantId, name: "Delta", storedRent: null, storedRentCurrency: "EUR" },
    ]);
    await seedRows(
      stack.db,
      buildEntityTable("dsqm-rent", rentEntity),
      [
        // P1: the newest entry wins, not the highest amount.
        { tenantId, propertyId: P1, validFrom: "2025-01-01", rent: 999999, rentCurrency: "EUR" },
        { tenantId, propertyId: P1, validFrom: "2026-01-01", rent: 120050, rentCurrency: "EUR" },
        { tenantId, propertyId: P2, validFrom: "2026-02-01", rent: 90000, rentCurrency: "CHF" },
        { tenantId, propertyId: P3, validFrom: "2026-03-01", rent: 50000, rentCurrency: "EUR" },
      ].map((row) => ({ secretRent: 777, secretRentCurrency: "EUR", ...row })),
    );
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("amount and currency arrive in the shape of a stored money field", async () => {
    const page = await list({ limit: 10 });

    expect(rowOf(page, P1)?.["currentRent"]).toEqual({
      amount: 1200.5,
      currency: "EUR",
      amountScaled: 120050,
      amountMinor: 120050,
    });
    expect(rowOf(page, P2)?.["currentRent"]).toMatchObject({ amount: 900, currency: "CHF" });
    expect(rowOf(page, P1)?.["currentRent"]).toEqual(rowOf(page, P1)?.["storedRent"]);
    expect(rowOf(page, P2)?.["currentRent"]).toEqual(rowOf(page, P2)?.["storedRent"]);
  });

  test("a property without a matching row has no key, like an unset stored money field", async () => {
    const row = rowOf(await list({ limit: 10 }), P4);

    expect(row).toBeDefined();
    expect(Object.hasOwn(row ?? {}, "currentRent")).toBe(false);
    expect(Object.hasOwn(row ?? {}, "storedRent")).toBe(false);
    expect(Object.hasOwn(row ?? {}, "currentRentCurrency")).toBe(false);
  });

  test("sorts by minor units in both directions, rows without a value last ascending", async () => {
    const asc = await list({ sort: "currentRent", sortDirection: "asc", limit: 10 });
    const desc = await list({ sort: "currentRent", sortDirection: "desc", limit: 10 });

    expect(ids(asc).slice(0, 3)).toEqual([P3, P2, P1]);
    expect(ids(desc).slice(-3)).toEqual([P1, P2, P3]);
  });

  test("a viewer who cannot read the measured money field gets no value and id order", async () => {
    const asUser = await list(
      { sort: "currentSecretRent", sortDirection: "desc", limit: 10 },
      TestUsers.user,
    );

    for (const row of asUser.rows) expect(Object.hasOwn(row, "currentSecretRent")).toBe(false);
    expect(ids(asUser)).toEqual([P1, P2, P3, P4]);

    const asAdmin = await list({ limit: 10 });
    expect(rowOf(asAdmin, P1)?.["currentSecretRent"]).toMatchObject({ amount: 7.77 });
  });
});
