import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createTemplateResolverApi } from "../api.ts";
import { SYSTEM_TENANT_ID } from "../constants.ts";
import { createTemplateResolverFeature } from "../feature.ts";
import { seedSystemTemplate } from "../seeding.ts";
import {
  type TemplateResourceRow,
  templateResourceEntity,
  templateResourcesTable,
} from "../table.ts";

let stack: TestStack;

const TENANT_ID = testTenantId(710) as TenantId;

const feature = createTemplateResolverFeature();

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("seedSystemTemplate", () => {
  test("legt System-Template an, resolveTemplate findet es für beliebigen Tenant", async () => {
    const slug = `welcome-${crypto.randomUUID()}`;
    await seedSystemTemplate(stack.db, {
      slug,
      kind: "ai-prompt",
      locale: "de",
      content: JSON.stringify({ header: "Willkommen", sections: [{ text: "Hallo" }] }),
      contentFormat: "plain",
    });

    const api = createTemplateResolverApi(stack.db, stack.registry);
    const resolved = await api.resolveTemplate({
      tenantId: TENANT_ID,
      slug,
      kind: "ai-prompt",
      locale: "de",
    });
    expect(resolved.content).toContain("Willkommen");
    expect(resolved.scope).toBe("system");
  });

  test('ifExists="update" überschreibt content', async () => {
    const slug = `incident-${crypto.randomUUID()}`;
    await seedSystemTemplate(stack.db, {
      slug,
      kind: "ai-prompt",
      locale: "en",
      content: "v1",
      contentFormat: "plain",
    });
    await seedSystemTemplate(stack.db, {
      slug,
      kind: "ai-prompt",
      locale: "en",
      content: "v2",
      contentFormat: "plain",
      ifExists: "update",
    });

    const row = await fetchOne<TemplateResourceRow>(stack.db, templateResourcesTable, {
      tenantId: SYSTEM_TENANT_ID,
      slug,
      kind: "ai-prompt",
      locale: "en",
    });
    expect(row?.content).toBe("v2");
    expect(row?.version).toBe(2);
  });

  test("default skip: zweiter Boot-Call ohne update ändert nichts", async () => {
    const slug = `status-${crypto.randomUUID()}`;
    await seedSystemTemplate(stack.db, {
      slug,
      kind: "ai-prompt",
      locale: "de",
      content: "original",
      contentFormat: "plain",
    });
    await seedSystemTemplate(stack.db, {
      slug,
      kind: "ai-prompt",
      locale: "de",
      content: "would-overwrite",
      contentFormat: "plain",
    });

    const row = await fetchOne<TemplateResourceRow>(stack.db, templateResourcesTable, {
      tenantId: SYSTEM_TENANT_ID,
      slug,
      kind: "ai-prompt",
      locale: "de",
    });
    expect(row?.content).toBe("original");
    expect(row?.version).toBe(1);
  });
});
