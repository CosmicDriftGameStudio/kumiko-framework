// A letterhead from layout to letter, through the real write pipeline over HTTP: the system layout
// carries its own look and company-data footer, the tenant's letter keeps its address frame, and
// apply-layout / publish-templates hand the layout to the letter.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  configValuesTable,
  createConfigAccessorFactory,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createTemplateResolverFeature,
  DEFAULT_PDF_LAYOUT_SLUG_CONFIG_KEY,
  TemplateResolverHandlers,
  TemplateResolverQueries,
  templateResourceEntity,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import {
  createTenantFeature,
  tenantEntity,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createUserFeature, userEntity } from "@cosmicdrift/kumiko-bundled-features/user";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  LETTER_HTML,
  LETTER_LOCALE,
  LETTER_SLUG,
  LETTERHEAD_LAYOUT_HTML,
  LETTERHEAD_LAYOUT_META,
  LETTERHEAD_LAYOUT_SLUG,
  TENANT_EDITABLE,
} from "../letterhead";

const admin = createTestUser({ id: 1, roles: ["TenantAdmin"], tenantId: testTenantId(1) });
const LETTER_REF = { slug: LETTER_SLUG, kind: "document-pdf", locale: LETTER_LOCALE } as const;

let stack: TestStack;
let letterId: string;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createTemplateResolverFeature({ tenantEditable: [...TENANT_EDITABLE] }),
    ],
    extraContext: ({ registry }) => {
      const resolver = createConfigResolver();
      return {
        configResolver: resolver,
        configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      };
    },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });

  await stack.http.writeOk(
    TemplateResolverHandlers.upsertSystem,
    {
      slug: LETTERHEAD_LAYOUT_SLUG,
      kind: "pdf-layout",
      locale: LETTER_LOCALE,
      content: LETTERHEAD_LAYOUT_HTML,
      contentFormat: "html",
      meta: LETTERHEAD_LAYOUT_META,
      variableSchema: {},
      linkedResources: {},
    },
    TestUsers.systemAdmin,
  );
  const stored = await stack.http.writeOk<{ id: string }>(
    TemplateResolverHandlers.upsertTenant,
    {
      ...LETTER_REF,
      content: LETTER_HTML,
      contentFormat: "html",
      status: "active",
      variableSchema: { recipientName: { type: "text" } },
    },
    admin,
  );
  letterId = stored.id;
});

afterAll(async () => {
  await stack.cleanup();
});

describe("pdf-letterhead", () => {
  test("the letter keeps its address frame and text style as written", async () => {
    const letter = await stack.http.queryOk<{ content: string }>(
      TemplateResolverQueries.findById,
      { id: letterId },
      admin,
    );
    expect(letter.content).toContain('data-frame-preset="address"');
    expect(letter.content).toContain('data-size-pt="14"');
  });

  test("the footer asks for company data the tenant has not entered", async () => {
    await stack.http.writeOk(
      "config:write:set",
      { key: "tenant:config:company-iban", value: "DE89 3704 0044 0532 0130 00" },
      admin,
    );
    const result = await stack.http.queryOk<{ emptyCompanyData: string[] }>(
      TemplateResolverQueries.validate,
      {
        ...LETTER_REF,
        content: LETTERHEAD_LAYOUT_HTML,
        contentFormat: "html",
        meta: {},
      },
      admin,
    );
    expect(result.emptyCompanyData).toContain("companyBic");
    expect(result.emptyCompanyData).not.toContain("companyIban");
  });

  test("apply-layout hands the layout to the letter, publish-templates activates it", async () => {
    const applied = await stack.http.writeOk<{ applied: { slug: string }[]; skipped: unknown[] }>(
      TemplateResolverHandlers.applyLayout,
      {
        layoutSlug: LETTERHEAD_LAYOUT_SLUG,
        target: { mode: "selected", templates: [{ slug: LETTER_SLUG, locale: LETTER_LOCALE }] },
      },
      admin,
    );
    expect(applied.applied.map((entry) => entry.slug)).toEqual([LETTER_SLUG]);
    expect(applied.skipped).toEqual([]);

    const published = await stack.http.writeOk<{
      published: { slug: string }[];
      failed: unknown[];
    }>(TemplateResolverHandlers.publishTemplates, { templates: [LETTER_REF] }, admin);
    expect(published.published.map((entry) => entry.slug)).toEqual([LETTER_SLUG]);

    const usage = await stack.http.queryOk<{
      usedByTemplates: { slug: string; hasOwnLayout: boolean }[];
    }>(TemplateResolverQueries.usage, { slug: LETTERHEAD_LAYOUT_SLUG, kind: "pdf-layout" }, admin);
    expect(usage.usedByTemplates).toMatchObject([{ slug: LETTER_SLUG, hasOwnLayout: true }]);
  });

  test("mode all makes the layout the tenant default without touching the letter", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.applyLayout,
      { layoutSlug: LETTERHEAD_LAYOUT_SLUG, target: { mode: "all" } },
      admin,
    );
    const values = await stack.http.queryOk<Record<string, { value?: unknown }>>(
      "config:query:values",
      { keys: [DEFAULT_PDF_LAYOUT_SLUG_CONFIG_KEY] },
      admin,
    );
    expect(values[DEFAULT_PDF_LAYOUT_SLUG_CONFIG_KEY]?.value).toBe(LETTERHEAD_LAYOUT_SLUG);
  });
});
