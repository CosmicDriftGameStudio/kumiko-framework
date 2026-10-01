// Package-level cases the recipe does NOT cover: unknown field at define time,
// and missing tenant-settings mount fails loud when currency is omitted.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { asRawClient } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createMoneyField,
  createSelectField,
  createTextField,
  defineFeature,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  pushEntityProjectionTables,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { defineCreateWithTenantDefaults } from "../tenant-defaults.js";

const invoiceEntity = createEntity({
  table: "read_invoices",
  fields: {
    title: createTextField({ required: true, personal: false, reason: "is_business_data" }),
    amount: createMoneyField({ required: true }),
    language: createSelectField({ options: ["en", "de"] as const }),
  },
});

const ACCESS = { roles: ["Admin"] } as const;

test("defineCreateWithTenantDefaults throws on an unknown currency field", () => {
  expect(() =>
    defineCreateWithTenantDefaults("invoice", invoiceEntity, {
      access: ACCESS,
      currencyFields: ["notARealField"],
    }),
  ).toThrow(/unknown field "notARealField"/);
});

test("defineCreateWithTenantDefaults throws on an unknown locale field", () => {
  expect(() =>
    defineCreateWithTenantDefaults("invoice", invoiceEntity, {
      access: ACCESS,
      localeField: "languge",
    }),
  ).toThrow(/unknown field "languge"/);
});

describe("without tenant-settings mount", () => {
  const invoiceFeature = defineFeature("invoice", (r) => {
    r.entity("invoice", invoiceEntity);
    r.writeHandler(
      defineCreateWithTenantDefaults("invoice", invoiceEntity, {
        access: ACCESS,
        currencyFields: ["amount"],
        localeField: "language",
      }),
    );
  });

  const tenantId = testTenantId(1);
  const admin: SessionUser = { id: "admin-1", tenantId, roles: ["Admin"] };
  let stack: TestStack;

  beforeAll(async () => {
    const resolver = createConfigResolver();
    // config feature only — no createTenantSettingsFeature()
    stack = await setupTestStack({
      features: [createConfigFeature(), invoiceFeature],
      extraContext: ({ registry }) => ({
        configResolver: resolver,
        _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      }),
    });
    await unsafePushTables(stack.db, { configValuesTable });
    await unsafeCreateEntityTable(stack.db, invoiceEntity);
    await pushEntityProjectionTables(stack, stack.registry);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("omitting money.currency fails loud (no silent feature-default fill)", async () => {
    const err = await stack.http.writeErr(
      "invoice:write:invoice:create",
      { title: "Invoice", amount: { amount: 1000 } },
      admin,
    );
    expect(err.httpStatus).toBeGreaterThanOrEqual(400);
  });
});

describe("caller-supplied id (#2922)", () => {
  const noteEntity = createEntity({
    table: "read_tenant_default_notes",
    fields: {
      title: createTextField({ required: true, personal: false, reason: "is_business_data" }),
    },
  });
  const noteFeature = defineFeature("note", (r) => {
    r.entity("note", noteEntity);
    r.writeHandler(defineCreateWithTenantDefaults("note", noteEntity, { access: ACCESS }));
  });

  const admin: SessionUser = { id: "admin-2", tenantId: testTenantId(2), roles: ["Admin"] };
  let stack: TestStack;

  beforeAll(async () => {
    const resolver = createConfigResolver();
    stack = await setupTestStack({
      features: [createConfigFeature(), noteFeature],
      extraContext: ({ registry }) => ({
        configResolver: resolver,
        _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      }),
    });
    await unsafePushTables(stack.db, { configValuesTable });
    await unsafeCreateEntityTable(stack.db, noteEntity);
    await pushEntityProjectionTables(stack, stack.registry);
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("an ordinary user's id is ignored, the row gets a generated id", async () => {
    const chosenId = "5f0c7a4e-8a1b-4c55-9d3e-1a2b3c4d5e6f";
    const res = await stack.http.write(
      "note:write:note:create",
      { id: chosenId, title: "hello" },
      admin,
    );
    expect(res.status).toBe(200);
    const rows = await asRawClient(stack.db).unsafe<{ id: string }>(
      'SELECT id FROM "read_tenant_default_notes"',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).not.toBe(chosenId);
  });
});
