// send-test-status tells the editor whether a test mail can reach the caller, without
// exposing the address.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.ts";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.ts";
import { deliveryAttemptsTable, notificationPreferencesTable } from "../../delivery/tables.ts";
import { createMailFoundationFeature } from "../../mail-foundation/feature.ts";
import { createMailTransportInMemoryFeature } from "../../mail-transport-inmemory/index.ts";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity } from "../../user/schema/user.ts";
import { createTemplateResolverFeature } from "../feature.ts";
import { templateResourceEntity } from "../table.ts";
import { TemplateResolverQueries } from "../web/qualified-names.ts";

const admin = createTestUser({ id: 801, roles: ["SystemAdmin"], tenantId: testTenantId(801) });
const ADDRESS = "editor@send-test-status.test";

async function statusOf(stack: TestStack): Promise<unknown> {
  const response = await stack.http.query(TemplateResolverQueries.sendTestStatus, {}, admin);
  return (await response.json()).data;
}

describe("template-resolver :: send-test-status with an email channel", () => {
  let stack: TestStack;
  let resolvedAddress: string | null = ADDRESS;

  beforeAll(async () => {
    const resolver = createConfigResolver();
    stack = await setupTestStack({
      features: [
        createConfigFeature(),
        createUserFeature(),
        createTenantFeature(),
        createTemplateResolverFeature(),
        createRendererFoundationFeature(),
        createRendererMailHtmlFeature(),
        createDeliveryFeature(),
        createMailFoundationFeature(),
        createMailTransportInMemoryFeature(),
        createChannelEmailFeature({
          transport: createInMemoryTransport(),
          resolveEmail: async () => resolvedAddress,
        }),
      ],
      extraContext: (deps) => ({
        ...createDeliveryTestContext(deps),
        configResolver: resolver,
        _configAccessorFactory: createConfigAccessorFactory(deps.registry, resolver),
      }),
    });
    await unsafeCreateEntityTable(stack.db, userEntity);
    await unsafeCreateEntityTable(stack.db, tenantEntity);
    await unsafeCreateEntityTable(stack.db, templateResourceEntity);
    await unsafePushTables(stack.db, {
      configValuesTable,
      tenantMembershipsTable,
      notificationPreferencesTable,
      deliveryAttemptsTable,
    });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("a resolvable address means canSend, and the address is not in the response", async () => {
    resolvedAddress = ADDRESS;

    const response = await stack.http.query(TemplateResolverQueries.sendTestStatus, {}, admin);
    const text = await response.text();

    expect(JSON.parse(text).data).toEqual({ canSend: true, reason: null });
    expect(text).not.toContain(ADDRESS);
  });

  test("a channel that resolves no address reports no_address", async () => {
    resolvedAddress = null;

    expect(await statusOf(stack)).toEqual({ canSend: false, reason: "no_address" });
  });
});

describe("template-resolver :: send-test-status without an email channel", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await setupTestStack({ features: [createTemplateResolverFeature()] });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("reports no_channel", async () => {
    expect(await statusOf(stack)).toEqual({ canSend: false, reason: "no_channel" });
  });
});
