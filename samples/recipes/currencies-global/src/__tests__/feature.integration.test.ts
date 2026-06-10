// Money Sample — Integration Test
// Proves: money fields store correctly, per-tenant currency validation works,
// reference data seeding, custom currencies, assertExistsIn from framework
//
// ┌──────────┬────────────────────────────┬──────────────────────────┐
// │          │ Tenant 1                   │ Tenant 2                 │
// ├──────────┼────────────────────────────┼──────────────────────────┤
// │ Standard │ EUR, USD                   │ USD, GBP, JPY            │
// │ Custom   │ BHD, XYZ                   │ TRY, KRW, BRL            │
// │ Inactive │ —                          │ KRW (isActive: false)    │
// ├──────────┼────────────────────────────┼──────────────────────────┤
// │ Allowed  │ EUR, USD, BHD, XYZ         │ USD, GBP, JPY, TRY, BRL │
// │ Denied   │ GBP, TRY, KRW, ...        │ EUR, BHD, XYZ, KRW, ... │
// └──────────┴────────────────────────────┴──────────────────────────┘
// XYZ is NOT in DEFAULT_CURRENCIES — proves custom currencies work end-to-end

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { seedReferenceData } from "@cosmicdrift/kumiko-framework/db";
import type { SaveContext } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-framework/testing";
import { currencyEntity, currencyTable } from "../entities/currency";
import { invoiceEntity } from "../entities/invoice";
import { tenantCurrencyEntity } from "../entities/tenant-currency";
import { currenciesGlobalFeature } from "../feature";

let stack: TestStack;

const tenant1Admin = TestUsers.admin;
const tenant2Admin = createTestUser({ id: 2, tenantId: "00000000-0000-4000-8000-000000000002" });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [currenciesGlobalFeature],
    systemHooks: [],
  });

  await unsafeCreateEntityTable(stack.db, currencyEntity);
  await unsafeCreateEntityTable(stack.db, tenantCurrencyEntity);
  await unsafeCreateEntityTable(stack.db, invoiceEntity);

  // Seed global currency table — same as r.referenceData() does at boot
  const tables = new Map([["currency", currencyTable]]);
  await seedReferenceData(currenciesGlobalFeature.referenceData, tables, stack.db);

  // --- Assign currencies to tenant 1: EUR, USD (standard) + BHD, XYZ (custom) ---
  for (const currencyCode of ["EUR", "USD", "BHD", "XYZ"]) {
    await stack.http.writeOk<SaveContext>(
      "currencies-global:write:tenant-currency:assign",
      { currencyCode },
      tenant1Admin,
    );
  }

  // --- Assign currencies to tenant 2: USD, GBP, JPY (standard) + TRY, KRW, BRL (custom) ---
  for (const currencyCode of ["USD", "GBP", "JPY", "TRY", "KRW", "BRL"]) {
    await stack.http.writeOk<SaveContext>(
      "currencies-global:write:tenant-currency:assign",
      { currencyCode, isActive: currencyCode !== "KRW" },
      tenant2Admin,
    );
  }
});

afterAll(async () => {
  await stack.cleanup();
});

// --- Tenant 1: EUR, USD, BHD, XYZ allowed ---

describe("tenant 1: allowed currencies", () => {
  test("create invoice with EUR (standard) succeeds", async () => {
    const data = await stack.http.writeOk<SaveContext>(
      "currencies-global:write:invoice:create",
      { title: "Invoice T1-EUR", amount: 150050, amountCurrency: "EUR" },
      tenant1Admin,
    );
    expect(data.isNew).toBe(true);
    expect(data.data["amount"]).toBe(150050);
    expect(data.data["amountCurrency"]).toBe("EUR");
  });

  test("create invoice with BHD (custom, in DEFAULT_CURRENCIES) succeeds", async () => {
    const data = await stack.http.writeOk<SaveContext>(
      "currencies-global:write:invoice:create",
      { title: "Invoice T1-BHD", amount: 25075, amountCurrency: "BHD" },
      tenant1Admin,
    );
    expect(data.isNew).toBe(true);
    expect(data.data["amountCurrency"]).toBe("BHD");
  });

  test("create invoice with XYZ (NOT in DEFAULT_CURRENCIES) succeeds", async () => {
    const data = await stack.http.writeOk<SaveContext>(
      "currencies-global:write:invoice:create",
      { title: "Invoice T1-XYZ", amount: 42, amountCurrency: "XYZ" },
      tenant1Admin,
    );
    expect(data.isNew).toBe(true);
    expect(data.data["amountCurrency"]).toBe("XYZ");
  });

  test("create invoice with shipping cost in different currency", async () => {
    const data = await stack.http.writeOk<SaveContext>(
      "currencies-global:write:invoice:create",
      {
        title: "Invoice with shipping",
        amount: 1000,
        amountCurrency: "EUR",
        shippingCost: 4999,
        shippingCostCurrency: "USD",
      },
      tenant1Admin,
    );
    expect(data.isNew).toBe(true);
    expect(data.data["amountCurrency"]).toBe("EUR");
    expect(data.data["shippingCostCurrency"]).toBe("USD");
  });
});

// --- Tenant 1: denied currencies ---

describe("tenant 1: denied currencies", () => {
  test("create invoice with GBP fails (not assigned to tenant 1)", async () => {
    const error = await stack.http.writeErr(
      "currencies-global:write:invoice:create",
      { title: "Should fail", amount: 100, amountCurrency: "GBP" },
      tenant1Admin,
    );
    expectErrorIncludes(error, "currency_not_allowed");
  });

  test("create invoice with TRY fails (not assigned to tenant 1)", async () => {
    const error = await stack.http.writeErr(
      "currencies-global:write:invoice:create",
      { title: "Should fail", amount: 100, amountCurrency: "TRY" },
      tenant1Admin,
    );
    expectErrorIncludes(error, "currency_not_allowed");
  });
});

// --- Tenant 2: USD, GBP, JPY, TRY, BRL allowed (KRW inactive) ---

describe("tenant 2: allowed currencies", () => {
  test("create invoice with GBP succeeds", async () => {
    const data = await stack.http.writeOk<SaveContext>(
      "currencies-global:write:invoice:create",
      { title: "Invoice T2-GBP", amount: 99999, amountCurrency: "GBP" },
      tenant2Admin,
    );
    expect(data.isNew).toBe(true);
    expect(data.data["amountCurrency"]).toBe("GBP");
  });

  test("create invoice with TRY (custom) succeeds", async () => {
    const data = await stack.http.writeOk<SaveContext>(
      "currencies-global:write:invoice:create",
      { title: "Invoice T2-TRY", amount: 50000, amountCurrency: "TRY" },
      tenant2Admin,
    );
    expect(data.isNew).toBe(true);
    expect(data.data["amountCurrency"]).toBe("TRY");
  });
});

// --- Tenant 2: denied currencies ---

describe("tenant 2: denied currencies", () => {
  test("create invoice with EUR fails (not assigned to tenant 2)", async () => {
    const error = await stack.http.writeErr(
      "currencies-global:write:invoice:create",
      { title: "Should fail", amount: 100, amountCurrency: "EUR" },
      tenant2Admin,
    );
    expectErrorIncludes(error, "currency_not_allowed");
  });

  test("create invoice with KRW fails (inactive in tenant 2)", async () => {
    const error = await stack.http.writeErr(
      "currencies-global:write:invoice:create",
      { title: "Should fail", amount: 100, amountCurrency: "KRW" },
      tenant2Admin,
    );
    expectErrorIncludes(error, "currency_not_allowed");
  });

  test("create invoice with BHD fails (not assigned to tenant 2)", async () => {
    const error = await stack.http.writeErr(
      "currencies-global:write:invoice:create",
      { title: "Should fail", amount: 100, amountCurrency: "BHD" },
      tenant2Admin,
    );
    expectErrorIncludes(error, "currency_not_allowed");
  });
});

// --- Cross-tenant isolation ---

describe("tenant isolation", () => {
  test("tenant 2 cannot use tenant 1's BHD", async () => {
    const error = await stack.http.writeErr(
      "currencies-global:write:invoice:create",
      { title: "Cross-tenant", amount: 100, amountCurrency: "BHD" },
      tenant2Admin,
    );
    expectErrorIncludes(error, "currency_not_allowed");
  });

  test("tenant 2 cannot use tenant 1's XYZ (not in DEFAULT_CURRENCIES)", async () => {
    const error = await stack.http.writeErr(
      "currencies-global:write:invoice:create",
      { title: "Cross-tenant", amount: 100, amountCurrency: "XYZ" },
      tenant2Admin,
    );
    expectErrorIncludes(error, "currency_not_allowed");
  });

  test("tenant 1 cannot use tenant 2's TRY", async () => {
    const error = await stack.http.writeErr(
      "currencies-global:write:invoice:create",
      { title: "Cross-tenant", amount: 100, amountCurrency: "TRY" },
      tenant1Admin,
    );
    expectErrorIncludes(error, "currency_not_allowed");
  });
});

// --- Shipping currency validation ---

describe("shipping currency validation", () => {
  test("valid amount + invalid shipping currency fails", async () => {
    const error = await stack.http.writeErr(
      "currencies-global:write:invoice:create",
      {
        title: "Bad shipping",
        amount: 100,
        amountCurrency: "EUR",
        shippingCost: 10,
        shippingCostCurrency: "GBP", // not assigned to tenant 1
      },
      tenant1Admin,
    );
    expectErrorIncludes(error, "currency_not_allowed");
  });
});

// --- Detail query ---

describe("invoice detail", () => {
  test("detail returns the correct invoice by id", async () => {
    const _first = await stack.http.writeOk<SaveContext>(
      "currencies-global:write:invoice:create",
      { title: "Detail-First", amount: 100, amountCurrency: "EUR" },
      tenant1Admin,
    );
    const second = await stack.http.writeOk<SaveContext>(
      "currencies-global:write:invoice:create",
      { title: "Detail-Second", amount: 200, amountCurrency: "USD" },
      tenant1Admin,
    );

    const detail = await stack.http.queryOk<Record<string, unknown>>(
      "currencies-global:query:invoice:detail",
      { id: second.id },
      tenant1Admin,
    );
    expect(detail["id"]).toBe(second.id);
    expect(detail["title"]).toBe("Detail-Second");
    expect(detail["amountCurrency"]).toBe("USD");
  });

  test("detail returns null for other tenant's invoice", async () => {
    const created = await stack.http.writeOk<SaveContext>(
      "currencies-global:write:invoice:create",
      { title: "Tenant1-Only", amount: 50, amountCurrency: "EUR" },
      tenant1Admin,
    );

    const detail = await stack.http.queryOk<null>(
      "currencies-global:query:invoice:detail",
      { id: created.id },
      tenant2Admin,
    );
    expect(detail).toBeNull();
  });
});
