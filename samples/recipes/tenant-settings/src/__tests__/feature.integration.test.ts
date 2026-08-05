// End-to-end over real HTTP: a tenant's currency/locale setting flows into
// a new invoice's money/locale fields without the caller specifying them.

import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { createTenantSettingsFeature } from "@cosmicdrift/kumiko-bundled-features/tenant-settings";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  pushEntityProjectionTables,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { invoiceEntity, invoiceFeature } from "../feature";

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

test("no tenant override yet — new invoice gets the feature's own default (EUR/en)", async () => {
  const invoice = await stack.http.writeOk<{
    data: {
      amount: { amount: number; currency: string; amountMinor: number };
      language: string;
    };
  }>("invoice:write:invoice:create", { title: "Invoice 1", amount: { amount: 1000 } }, admin);
  expect(invoice.data.amount).toEqual({ amount: 1000, currency: "EUR", amountMinor: 100_000 });
  expect(invoice.data.language).toBe("en");
});

test("tenant sets CHF/de — a new invoice without explicit values picks up the tenant setting", async () => {
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
    data: {
      amount: { amount: number; currency: string; amountMinor: number };
      language: string;
    };
  }>("invoice:write:invoice:create", { title: "Invoice 2", amount: { amount: 2000 } }, admin);

  expect(invoice.data.amount).toEqual({ amount: 2000, currency: "CHF", amountMinor: 200_000 });
  expect(invoice.data.language).toBe("de");
});

test("an explicit value in the payload wins over the tenant setting", async () => {
  const invoice = await stack.http.writeOk<{
    data: { amount: { amount: number; currency: string; amountMinor: number } };
  }>(
    "invoice:write:invoice:create",
    { title: "Invoice 3", amount: { amount: 3000, currency: "USD" } },
    admin,
  );
  expect(invoice.data.amount).toEqual({ amount: 3000, currency: "USD", amountMinor: 300_000 });
});
