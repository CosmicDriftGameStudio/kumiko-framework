import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTemplateResolverFeature,
  type TemplateResourceRow,
  templateResourceEntity,
  templateResourcesTable,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createRegistry,
  defineFeature,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import * as z from "zod";
import { applyBootSeeds } from "../boot/apply-boot-seeds.js";

const mailer = defineFeature("boot-mailer", (r) => {
  r.writeHandler({
    name: "create",
    schema: z.object({}),
    access: { roles: ["TenantAdmin"] },
    handler: async () => ({ isSuccess: true as const, data: {} }),
  });
  r.notification("hello", {
    trigger: { on: "create" },
    recipient: () => null,
    data: () => ({}),
    template: { de: { body: "<p>Hallo</p>" } },
    meta: { de: { subject: "Hallo" } },
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createTemplateResolverFeature(), mailer] });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("applyBootSeeds :: notification templates", () => {
  test("seeds the mail row declared by a notification", async () => {
    await applyBootSeeds({ registry: stack.registry, db: stack.db });
    const row = await fetchOne<TemplateResourceRow>(stack.db, templateResourcesTable, {
      tenantId: SYSTEM_TENANT_ID,
      slug: "boot-mailer:notify:hello",
      kind: "mail",
      locale: "de",
    });
    expect(row?.content).toBe("<p>Hallo</p>");
  });

  test("throws when the template-resolver feature is not mounted", async () => {
    await expect(
      applyBootSeeds({ registry: createRegistry([mailer]), db: stack.db }),
    ).rejects.toThrow(/template-resolver/);
  });
});
