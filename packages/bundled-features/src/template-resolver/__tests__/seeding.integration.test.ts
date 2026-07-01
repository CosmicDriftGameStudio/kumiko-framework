import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTemplateResolverApi } from "../api";
import { SYSTEM_TENANT_ID } from "../constants";
import { createTemplateResolverFeature } from "../feature";
import { seedSystemTemplate } from "../seeding";
import { type TemplateResourceRow, templateResourceEntity, templateResourcesTable } from "../table";

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
      kind: "notification",
      locale: "de",
      content: JSON.stringify({ header: "Willkommen", sections: [{ text: "Hallo" }] }),
      contentFormat: "plain",
    });

    const api = createTemplateResolverApi(stack.db);
    const resolved = await api.resolveTemplate({
      tenantId: TENANT_ID,
      slug,
      kind: "notification",
      locale: "de",
    });
    expect(resolved.content).toContain("Willkommen");
    expect(resolved.scope).toBe("system");
  });

  test('ifExists="update" überschreibt content', async () => {
    const slug = `incident-${crypto.randomUUID()}`;
    await seedSystemTemplate(stack.db, {
      slug,
      kind: "notification",
      locale: "en",
      content: "v1",
      contentFormat: "plain",
    });
    await seedSystemTemplate(stack.db, {
      slug,
      kind: "notification",
      locale: "en",
      content: "v2",
      contentFormat: "plain",
      ifExists: "update",
    });

    const row = await fetchOne<TemplateResourceRow>(stack.db, templateResourcesTable, {
      tenantId: SYSTEM_TENANT_ID,
      slug,
      kind: "notification",
      locale: "en",
    });
    expect(row?.content).toBe("v2");
    expect(row?.version).toBe(2);
  });

  test("default skip: zweiter Boot-Call ohne update ändert nichts", async () => {
    const slug = `status-${crypto.randomUUID()}`;
    await seedSystemTemplate(stack.db, {
      slug,
      kind: "notification",
      locale: "de",
      content: "original",
      contentFormat: "plain",
    });
    await seedSystemTemplate(stack.db, {
      slug,
      kind: "notification",
      locale: "de",
      content: "would-overwrite",
      contentFormat: "plain",
    });

    const row = await fetchOne<TemplateResourceRow>(stack.db, templateResourcesTable, {
      tenantId: SYSTEM_TENANT_ID,
      slug,
      kind: "notification",
      locale: "de",
    });
    expect(row?.content).toBe("original");
    expect(row?.version).toBe(1);
  });
});
