import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createTemplateResolverApi } from "../api.ts";
import { createTemplateResolverFeature } from "../feature.ts";
import { seedSystemTemplate, seedTextBlock } from "../seeding.ts";
import {
  type TemplateResourceRow,
  templateResourceEntity,
  templateResourcesTable,
} from "../table.ts";
import { SYSTEM_TENANT_ID, TEXT_BLOCK_KIND } from "../web/constants.ts";

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
  test("creates a system template, and resolveTemplate finds it for any tenant", async () => {
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

  test('ifExists="update" overwrites content', async () => {
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

  test("default skip: second boot call without update changes nothing", async () => {
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

describe("seedSystemTemplate :: reserved layout namespace", () => {
  test("a system layout cannot take a tenant-layout- slug", async () => {
    await expect(
      seedSystemTemplate(stack.db, {
        slug: "tenant-layout-brief",
        kind: "pdf-layout",
        locale: "de",
        content: "<div data-content></div>",
        contentFormat: "html",
      }),
    ).rejects.toThrow("reserved_layout_slug");
  });
});

describe("parallel seeds", () => {
  test("two concurrent seedSystemTemplate calls for one key resolve to one row", async () => {
    const slug = `race-${crypto.randomUUID()}`;
    const opts = {
      slug,
      kind: "ai-prompt" as const,
      locale: "de",
      content: "x",
      contentFormat: "plain" as const,
      ifExists: "skip" as const,
    };
    const [a, b] = await Promise.all([
      seedSystemTemplate(stack.db, opts),
      seedSystemTemplate(stack.db, opts),
    ]);
    expect(a.id).toBe(b.id);
    const rows = await selectMany(stack.db, templateResourcesTable, {
      tenantId: SYSTEM_TENANT_ID,
      slug,
      kind: "ai-prompt",
      locale: "de",
    });
    expect(rows).toHaveLength(1);
  });

  test("two concurrent seedTextBlock calls for one key resolve to one row", async () => {
    const slug = `race-${crypto.randomUUID()}`;
    const opts = {
      tenantId: TENANT_ID,
      slug,
      locale: "de",
      title: "T",
      content: "x",
      ifExists: "skip" as const,
    };
    const [a, b] = await Promise.all([seedTextBlock(stack.db, opts), seedTextBlock(stack.db, opts)]);
    expect(a.id).toBe(b.id);
    const rows = await selectMany(stack.db, templateResourcesTable, {
      tenantId: TENANT_ID,
      slug,
      kind: TEXT_BLOCK_KIND,
      locale: "de",
    });
    expect(rows).toHaveLength(1);
  });
});
