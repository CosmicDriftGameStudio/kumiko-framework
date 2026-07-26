// Verifies the core promise: set a tenant's tenant-settings:config:currency
// to CHF, and a new entity without an explicit currency inherits CHF instead
// of a hard-coded EUR literal.

import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createEntity,
  createMoneyField,
  createSelectField,
  createTextField,
  defineFeature,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  pushEntityProjectionTables,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTenantSettingsFeature } from "../feature";
import { defineCreateWithTenantDefaults } from "../tenant-defaults";

const invoiceEntity = createEntity({
  table: "read_invoices",
  fields: {
    title: createTextField({ required: true }),
    amount: createMoneyField({ required: true }),
    language: createSelectField({ options: ["en", "de"] as const }),
  },
});

const ACCESS = { roles: ["Admin"] } as const;

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
  stack = await setupTestStack({
    features: [createConfigFeature(), createTenantSettingsFeature(), invoiceFeature],
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  await unsafePushTables(stack.db, { configValuesTable });
  await unsafeCreateEntityTable(stack.db, invoiceEntity);
  await createEventsTable(stack.db);
  await pushEntityProjectionTables(stack, stack.registry);
});

afterAll(async () => {
  await stack.cleanup();
});

test("ohne Tenant-Override übernimmt eine neue Entity den Feature-Default (EUR/en)", async () => {
  const invoice = await stack.http.writeOk<{
    data: { amount: { amount: number; currency: string }; language: string };
  }>("invoice:write:invoice:create", { title: "Rechnung 1", amount: { amount: 1000 } }, admin);
  expect(invoice.data.amount).toEqual({ amount: 1000, currency: "EUR" });
  expect(invoice.data.language).toBe("en");
});

test("Tenant setzt CHF/de — neue Entity ohne explizite Werte übernimmt die Tenant-Config, nicht das Feature-Default", async () => {
  await stack.http.writeOk(
    "config:write:set",
    { key: "tenant-settings:config:currency", value: "CHF" },
    admin,
  );
  await stack.http.writeOk(
    "config:write:set",
    { key: "tenant-settings:config:locale", value: "de" },
    admin,
  );

  const invoice = await stack.http.writeOk<{
    data: { amount: { amount: number; currency: string }; language: string };
  }>("invoice:write:invoice:create", { title: "Rechnung 2", amount: { amount: 2000 } }, admin);

  expect(invoice.data.amount).toEqual({ amount: 2000, currency: "CHF" });
  expect(invoice.data.language).toBe("de");
});

test("expliziter Wert im Payload gewinnt gegen die Tenant-Config", async () => {
  const invoice = await stack.http.writeOk<{
    data: { amount: { amount: number; currency: string } };
  }>(
    "invoice:write:invoice:create",
    { title: "Rechnung 3", amount: { amount: 3000, currency: "USD" } },
    admin,
  );
  expect(invoice.data.amount).toEqual({ amount: 3000, currency: "USD" });
});
