// Money Tenant Sample — Integration Test
// Proves: tenant-owned currencies, each tenant has their own list,
// no shared data, isActive filter, cross-tenant isolation
//
// ┌──────────┬─────────────────────────┬─────────────────────────┐
// │          │ Tenant 1                │ Tenant 2                │
// ├──────────┼─────────────────────────┼─────────────────────────┤
// │ Active   │ EUR, USD, XYZ           │ GBP, JPY, TRY           │
// │ Inactive │ —                       │ KRW                     │
// ├──────────┼─────────────────────────┼─────────────────────────┤
// │ Allowed  │ EUR, USD, XYZ           │ GBP, JPY, TRY           │
// │ Denied   │ GBP, JPY, TRY, KRW     │ EUR, USD, XYZ, KRW      │
// └──────────┴─────────────────────────┴─────────────────────────┘
// XYZ is a custom currency — not ISO, created by tenant 1

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SaveContext } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-framework/testing";
import { currencyEntity } from "../entities/currency";
import { invoiceEntity } from "../entities/invoice";
import { currenciesPerTenantFeature } from "../feature";

// The executor returns the rehydrated read-form: money is the combined
// { amount, currency }, not the flat amount/amountCurrency columns insertOne leaked.
const asMoney = (v: unknown) => v as { amount: number; currency: string };

let stack: TestStack;

const tenant1Admin = TestUsers.admin;
const tenant2Admin = createTestUser({ id: 2, tenantId: "00000000-0000-4000-8000-000000000002" });

beforeAll(async () => {
  stack = await setupTestStack({
    features: [currenciesPerTenantFeature],
    systemHooks: [],
  });

  await unsafeCreateEntityTable(stack.db, currencyEntity);
  await unsafeCreateEntityTable(stack.db, invoiceEntity);

  // Tenant 1 creates their own currencies: EUR, USD, XYZ
  for (const { code, name } of [
    { code: "EUR", name: "Euro" },
    { code: "USD", name: "US Dollar" },
    { code: "XYZ", name: "Custom Token" },
  ]) {
    await stack.http.writeOk<SaveContext>(
      "currencies-per-tenant:write:currency:create",
      { code, name },
      tenant1Admin,
    );
  }

  // Tenant 2 creates their own currencies: GBP, JPY, TRY, KRW (inactive)
  for (const { code, name, isActive } of [
    { code: "GBP", name: "British Pound", isActive: true },
    { code: "JPY", name: "Japanese Yen", isActive: true },
    { code: "TRY", name: "Turkish Lira", isActive: true },
    { code: "KRW", name: "Korean Won", isActive: false },
  ]) {
    await stack.http.writeOk<SaveContext>(
      "currencies-per-tenant:write:currency:create",
      { code, name, isActive },
      tenant2Admin,
    );
  }
});

afterAll(async () => {
  await stack.cleanup();
});

// --- Tenant 1 ---

describe("tenant 1: allowed currencies", () => {
  test("create invoice with EUR succeeds", async () => {
    const data = await stack.http.writeOk<SaveContext>(
      "currencies-per-tenant:write:invoice:create",
      { title: "Invoice T1-EUR", amount: 150050, amountCurrency: "EUR" },
      tenant1Admin,
    );
    expect(data.isNew).toBe(true);
    expect(asMoney(data.data["amount"]).amount).toBe(150050);
    expect(asMoney(data.data["amount"]).currency).toBe("EUR");
  });

  test("create invoice with XYZ (custom tenant currency) succeeds", async () => {
    const data = await stack.http.writeOk<SaveContext>(
      "currencies-per-tenant:write:invoice:create",
      { title: "Invoice T1-XYZ", amount: 42, amountCurrency: "XYZ" },
      tenant1Admin,
    );
    expect(data.isNew).toBe(true);
    expect(asMoney(data.data["amount"]).currency).toBe("XYZ");
  });
});

describe("tenant 1: denied currencies", () => {
  test("GBP fails (tenant 1 never created it)", async () => {
    const error = await stack.http.writeErr(
      "currencies-per-tenant:write:invoice:create",
      { title: "Fail", amount: 100, amountCurrency: "GBP" },
      tenant1Admin,
    );
    expectErrorIncludes(error, "currency_not_allowed");
  });
});

// --- Tenant 2 ---

describe("tenant 2: allowed currencies", () => {
  test("create invoice with GBP succeeds", async () => {
    const data = await stack.http.writeOk<SaveContext>(
      "currencies-per-tenant:write:invoice:create",
      { title: "Invoice T2-GBP", amount: 99999, amountCurrency: "GBP" },
      tenant2Admin,
    );
    expect(data.isNew).toBe(true);
    expect(asMoney(data.data["amount"]).currency).toBe("GBP");
  });
});

describe("tenant 2: denied currencies", () => {
  test("EUR fails (tenant 2 never created it)", async () => {
    const error = await stack.http.writeErr(
      "currencies-per-tenant:write:invoice:create",
      { title: "Fail", amount: 100, amountCurrency: "EUR" },
      tenant2Admin,
    );
    expectErrorIncludes(error, "currency_not_allowed");
  });

  test("KRW fails (inactive)", async () => {
    const error = await stack.http.writeErr(
      "currencies-per-tenant:write:invoice:create",
      { title: "Fail", amount: 100, amountCurrency: "KRW" },
      tenant2Admin,
    );
    expectErrorIncludes(error, "currency_not_allowed");
  });
});

// --- Cross-tenant isolation ---

describe("tenant isolation", () => {
  test("tenant 2 cannot use tenant 1's XYZ", async () => {
    const error = await stack.http.writeErr(
      "currencies-per-tenant:write:invoice:create",
      { title: "Cross-tenant", amount: 100, amountCurrency: "XYZ" },
      tenant2Admin,
    );
    expectErrorIncludes(error, "currency_not_allowed");
  });

  test("tenant 1 cannot use tenant 2's TRY", async () => {
    const error = await stack.http.writeErr(
      "currencies-per-tenant:write:invoice:create",
      { title: "Cross-tenant", amount: 100, amountCurrency: "TRY" },
      tenant1Admin,
    );
    expectErrorIncludes(error, "currency_not_allowed");
  });
});

// --- Detail query ---

describe("invoice detail", () => {
  test("detail returns the correct invoice by id", async () => {
    const _first = await stack.http.writeOk<SaveContext>(
      "currencies-per-tenant:write:invoice:create",
      { title: "Detail-First", amount: 100, amountCurrency: "EUR" },
      tenant1Admin,
    );
    const second = await stack.http.writeOk<SaveContext>(
      "currencies-per-tenant:write:invoice:create",
      { title: "Detail-Second", amount: 200, amountCurrency: "USD" },
      tenant1Admin,
    );

    const detail = await stack.http.queryOk<Record<string, unknown>>(
      "currencies-per-tenant:query:invoice:detail",
      { id: second.id },
      tenant1Admin,
    );
    expect(detail["id"]).toBe(second.id);
    expect(detail["title"]).toBe("Detail-Second");
    expect(detail["amountCurrency"]).toBe("USD");
  });

  test("detail returns null for other tenant's invoice", async () => {
    const created = await stack.http.writeOk<SaveContext>(
      "currencies-per-tenant:write:invoice:create",
      { title: "Tenant1-Only", amount: 50, amountCurrency: "EUR" },
      tenant1Admin,
    );

    const detail = await stack.http.queryOk<null>(
      "currencies-per-tenant:query:invoice:detail",
      { id: created.id },
      tenant2Admin,
    );
    expect(detail).toBeNull();
  });
});
