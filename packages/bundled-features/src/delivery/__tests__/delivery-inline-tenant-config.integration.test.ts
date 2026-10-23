// An immediate notify (no job runner) renders through the same tenant config
// as the delivery.render job: the mail layout shows the tenant's name.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  type TenantId,
  templateVariable,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createChannelEmailFeature } from "../../channel-email/feature.ts";
import { createInMemoryTransport } from "../../channel-email/types.ts";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { BRANDING_QN, createManagedPagesFeature } from "../../managed-pages/index.ts";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.ts";
import { createTemplateResolverFeature } from "../../template-resolver/feature.ts";
import { seedNotificationTemplates } from "../../template-resolver/seeding.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { createTenantSettingsFeature } from "../../tenant-settings/index.ts";
import { createDeliveryFeature } from "../feature.ts";
import { createDeliveryTestContext } from "../testing.ts";
import type { DeliveryService } from "../types.ts";
import { scopedForTest } from "./scoped-delivery-service.ts";

const transport = createInMemoryTransport();

const probe = defineFeature("inline-config-probe", (r) => {
  r.requires({ features: ["delivery"] });
  r.notification("hello", {
    variables: { name: templateVariable.text({ required: true }) },
    template: { en: { body: '<p>Hello <span data-variable="name"></span></p>' } },
    meta: { en: { subject: "Hello" } },
  });
});

const NOTIFICATION_TYPE = "inline-config-probe:notify:hello";
const tenantAdmin = createTestUser({
  id: 51,
  roles: ["TenantAdmin"],
  tenantId: testTenantId(51),
});
const otherTenant: TenantId = testTenantId(52);

let stack: TestStack;
let deliveryService: DeliveryService;

beforeAll(async () => {
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createTenantSettingsFeature(),
      createManagedPagesFeature({ resolveApexTenant: () => null }),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createRendererMailHtmlFeature(),
      createDeliveryFeature(),
      createChannelEmailFeature({ transport, resolveEmail: async () => null }),
      probe,
    ],
    extraContext: (deps) => {
      const accessorFactory = createConfigAccessorFactory(deps.registry, resolver);
      const ctx = createDeliveryTestContext(deps, {
        tenantConfigFor: (tenantId) => {
          const systemUser = createSystemUser(tenantId);
          return accessorFactory({
            user: { id: systemUser.id, tenantId },
            db: createTenantDb({ db: deps.db, tenantId }),
          });
        },
      });
      deliveryService = scopedForTest(ctx.deliveryService);
      return {
        ...ctx,
        configResolver: resolver,
        configAccessorFactory: accessorFactory,
      };
    },
  });
  await unsafePushTables(stack.db, { configValuesTable });
  await seedNotificationTemplates(stack.db, stack.registry);
  await stack.http.writeOk(
    "config:write:set",
    { key: BRANDING_QN.title, value: "Muster AG", scope: "tenant" },
    tenantAdmin,
  );
});

afterAll(async () => {
  await stack.cleanup();
});

async function notifyImmediately(tenantId: TenantId, to: string) {
  await deliveryService.notify(
    NOTIFICATION_TYPE,
    { route: { email: to }, data: { name: "Ada" }, immediate: true },
    createSystemUser(tenantId),
    tenantId,
  );
  return transport.sent.find((mail) => mail.to === to);
}

describe("immediate notify renders with the tenant config", () => {
  test("the mail layout carries the tenant's configured name", async () => {
    const mail = await notifyImmediately(tenantAdmin.tenantId, "configured@test.local");
    expect(mail?.html).toContain("Muster AG");
  });

  test("another tenant without branding gets no foreign name", async () => {
    const mail = await notifyImmediately(otherTenant, "plain@test.local");
    expect(mail).toBeDefined();
    expect(mail?.html).not.toContain("Muster AG");
  });
});
