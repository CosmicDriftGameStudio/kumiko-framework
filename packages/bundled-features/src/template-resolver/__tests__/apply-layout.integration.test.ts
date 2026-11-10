// apply-layout, publish-templates, the PDF layout usage list and the empty company data hint
// run through the real write pipeline; nothing is mocked.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity } from "../../user/schema/user.ts";
import { createTemplateResolverFeature } from "../feature.ts";
import { templateResourceEntity } from "../table.ts";
import { DEFAULT_PDF_LAYOUT_SLUG_CONFIG_KEY } from "../web/constants.ts";
import {
  TemplateResolverErrors,
  TemplateResolverHandlers,
  TemplateResolverQueries,
} from "../web/qualified-names.ts";
import { tenantEditableTemplates } from "./tenant-editable-fixture.ts";

const LOCALE = "de";
const LAYOUT = "lay-a";
const OTHER_LAYOUT = "lay-b";
const NAMESPACED_LAYOUT = "brand:lay-c";
const OWN_DOC = "doc-own";
const SECOND_DOC = "doc-second";
const SYSTEM_DOC = "doc-sys";
const LOCKED_DOC = "doc-locked";
const UNKNOWN_LAYOUT = "no-such-layout";
const DRAFT_ONLY_LAYOUT = "lay-draft-only";
const LOCKED_LAYOUT = "lay-locked";

const TENANT_EDITABLE = tenantEditableTemplates(
  ["pdf-layout", "document-pdf"],
  [
    LAYOUT,
    OTHER_LAYOUT,
    NAMESPACED_LAYOUT,
    UNKNOWN_LAYOUT,
    DRAFT_ONLY_LAYOUT,
    OWN_DOC,
    SECOND_DOC,
    SYSTEM_DOC,
  ],
);

const LAYOUT_HTML =
  "<div data-header><p>HEAD</p></div><div data-content></div><div data-footer><p>FOOT</p></div>";

const admin = createTestUser({ id: 1, roles: ["TenantAdmin"], tenantId: testTenantId(1) });
const plainUser = createTestUser({ id: 2, roles: ["User"], tenantId: testTenantId(1) });

let stack: TestStack;

const documentPayload = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  kind: "document-pdf" as const,
  locale: LOCALE,
  content: "<p>Text</p>",
  contentFormat: "html" as const,
  variableSchema: {},
  ...extra,
});

const layoutPayload = (slug: string) => ({
  slug,
  kind: "pdf-layout" as const,
  locale: LOCALE,
  content: LAYOUT_HTML,
  contentFormat: "html" as const,
  variableSchema: {},
  linkedResources: {},
});

type Usage = {
  readonly usedByTemplates: readonly {
    slug: string;
    locale: string;
    title: string;
    hasOwnLayout: boolean;
    isSystem: boolean;
    status: "draft" | "active";
    version: number;
  }[];
};

const usageOf = (layoutSlug: string) =>
  stack.http.queryOk<Usage>(
    TemplateResolverQueries.usage,
    { slug: layoutSlug, kind: "pdf-layout" },
    admin,
  );

const draftMetaOf = async (slug: string) =>
  (
    await stack.http.queryOk<{ meta: Record<string, unknown> }>(
      TemplateResolverQueries.documentBlocks,
      { slug, kind: "document-pdf", locale: LOCALE },
      admin,
    )
  ).meta;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createTemplateResolverFeature({ tenantEditable: TENANT_EDITABLE }),
    ],
    extraContext: () => ({ configResolver: createConfigResolver() }),
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
  for (const slug of [LAYOUT, OTHER_LAYOUT, NAMESPACED_LAYOUT]) {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      layoutPayload(slug),
      TestUsers.systemAdmin,
    );
  }
  await stack.http.writeOk(
    TemplateResolverHandlers.upsertSystem,
    documentPayload(SYSTEM_DOC, { linkedResources: {} }),
    TestUsers.systemAdmin,
  );
  for (const slug of [OWN_DOC, SECOND_DOC]) {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      documentPayload(slug, { status: "active", meta: { layoutSlug: OTHER_LAYOUT } }),
      admin,
    );
  }
});

afterAll(async () => {
  await stack.cleanup();
});

describe("template-resolver :: apply-layout", () => {
  test("selected writes the layout into a draft per template and keeps the text", async () => {
    const result = await stack.http.writeOk<{
      applied: { slug: string }[];
      skipped: unknown[];
    }>(
      TemplateResolverHandlers.applyLayout,
      {
        layoutSlug: LAYOUT,
        target: {
          mode: "selected",
          templates: [
            { slug: OWN_DOC, locale: LOCALE },
            { slug: SYSTEM_DOC, locale: LOCALE },
          ],
        },
      },
      admin,
    );
    expect(result.applied.map((entry) => entry.slug).sort()).toEqual([OWN_DOC, SYSTEM_DOC]);
    expect(result.skipped).toEqual([]);
    expect((await draftMetaOf(OWN_DOC))["layoutSlug"]).toBe(LAYOUT);
    expect((await draftMetaOf(SYSTEM_DOC))["layoutSlug"]).toBe(LAYOUT);
    const listed = (await usageOf(LAYOUT)).usedByTemplates;
    expect(listed.find((entry) => entry.slug === OWN_DOC)).toMatchObject({ status: "draft" });
    expect(listed.find((entry) => entry.slug === SYSTEM_DOC)).toMatchObject({ status: "draft" });
    const stillServed = (await usageOf(OTHER_LAYOUT)).usedByTemplates;
    expect(stillServed.find((entry) => entry.slug === OWN_DOC)).toMatchObject({
      status: "active",
    });
  });

  test("selected skips a template the caller may not edit and applies the rest", async () => {
    const result = await stack.http.writeOk<{
      applied: { slug: string }[];
      skipped: { slug: string; locale: string; reason: string }[];
    }>(
      TemplateResolverHandlers.applyLayout,
      {
        layoutSlug: LAYOUT,
        target: {
          mode: "selected",
          templates: [
            { slug: SECOND_DOC, locale: LOCALE },
            { slug: LOCKED_DOC, locale: LOCALE },
          ],
        },
      },
      admin,
    );
    expect(result.applied.map((entry) => entry.slug)).toEqual([SECOND_DOC]);
    expect(result.skipped).toEqual([
      {
        slug: LOCKED_DOC,
        locale: LOCALE,
        reason: TemplateResolverErrors.templateNotTenantEditable,
      },
    ]);
  });

  test("an unknown layout is refused as not published and a plain user is refused", async () => {
    const unknown = await stack.http.write(
      TemplateResolverHandlers.applyLayout,
      { layoutSlug: UNKNOWN_LAYOUT, target: { mode: "all" } },
      admin,
    );
    expect(unknown.status).toBe(400);
    expect(await unknown.text()).toContain(TemplateResolverErrors.layoutNotPublished);
    const refused = await stack.http.write(
      TemplateResolverHandlers.applyLayout,
      { layoutSlug: LAYOUT, target: { mode: "all" } },
      plainUser,
    );
    expect(refused.status).toBe(403);
    const notEditable = await stack.http.write(
      TemplateResolverHandlers.applyLayout,
      { layoutSlug: LOCKED_LAYOUT, target: { mode: "all" } },
      admin,
    );
    expect(notEditable.status).toBe(403);
  });

  test("a layout that only exists as draft is refused until it is published", async () => {
    const defaultKey = async () =>
      (
        await stack.http.queryOk<Record<string, { value?: unknown }>>(
          "config:query:values",
          { keys: [DEFAULT_PDF_LAYOUT_SLUG_CONFIG_KEY] },
          admin,
        )
      )[DEFAULT_PDF_LAYOUT_SLUG_CONFIG_KEY]?.value;
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      { ...layoutPayload(DRAFT_ONLY_LAYOUT), status: "draft" },
      admin,
    );
    const before = await defaultKey();
    const refused = await stack.http.write(
      TemplateResolverHandlers.applyLayout,
      { layoutSlug: DRAFT_ONLY_LAYOUT, target: { mode: "all" } },
      admin,
    );
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain(TemplateResolverErrors.layoutNotPublished);
    expect(await defaultKey()).toBe(before);

    await stack.http.writeOk(
      TemplateResolverHandlers.publishTemplates,
      { templates: [{ slug: DRAFT_ONLY_LAYOUT, kind: "pdf-layout", locale: LOCALE }] },
      admin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.applyLayout,
      { layoutSlug: DRAFT_ONLY_LAYOUT, target: { mode: "all" } },
      admin,
    );
    expect(await defaultKey()).toBe(DRAFT_ONLY_LAYOUT);
  });

  test("all accepts a namespaced layout slug as tenant default", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.applyLayout,
      { layoutSlug: NAMESPACED_LAYOUT, target: { mode: "all" } },
      admin,
    );
    const values = await stack.http.queryOk<Record<string, { value?: unknown }>>(
      "config:query:values",
      { keys: [DEFAULT_PDF_LAYOUT_SLUG_CONFIG_KEY] },
      admin,
    );
    expect(values[DEFAULT_PDF_LAYOUT_SLUG_CONFIG_KEY]?.value).toBe(NAMESPACED_LAYOUT);
  });

  test("all sets the tenant default layout without copying templates", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.applyLayout,
      { layoutSlug: OTHER_LAYOUT, target: { mode: "all" } },
      admin,
    );
    const values = await stack.http.queryOk<Record<string, { value?: unknown }>>(
      "config:query:values",
      { keys: [DEFAULT_PDF_LAYOUT_SLUG_CONFIG_KEY] },
      admin,
    );
    expect(values[DEFAULT_PDF_LAYOUT_SLUG_CONFIG_KEY]?.value).toBe(OTHER_LAYOUT);
  });
});

describe("template-resolver :: publish-templates", () => {
  test("publishes drafts, reports a template without a draft and one that is refused", async () => {
    const result = await stack.http.writeOk<{
      published: { slug: string }[];
      failed: { slug: string; reason: string }[];
    }>(
      TemplateResolverHandlers.publishTemplates,
      {
        templates: [
          { slug: OWN_DOC, kind: "document-pdf", locale: LOCALE },
          { slug: LOCKED_DOC, kind: "document-pdf", locale: LOCALE },
          { slug: SYSTEM_DOC, kind: "document-pdf", locale: LOCALE },
        ],
      },
      admin,
    );
    expect(result.published.map((entry) => entry.slug).sort()).toEqual([OWN_DOC, SYSTEM_DOC]);
    expect(result.failed.map((entry) => entry.slug)).toEqual([LOCKED_DOC]);
  });

  test("a template that is active without a draft fails with template_already_active", async () => {
    const result = await stack.http.writeOk<{ failed: { reason: string }[] }>(
      TemplateResolverHandlers.publishTemplates,
      { templates: [{ slug: OWN_DOC, kind: "document-pdf", locale: LOCALE }] },
      admin,
    );
    expect(result.failed.map((entry) => entry.reason)).toEqual([
      TemplateResolverErrors.alreadyActive,
    ]);
  });
});

describe("template-resolver :: usage of a pdf-layout", () => {
  test("lists templates by the layout they effectively use", async () => {
    const own = (await usageOf(LAYOUT)).usedByTemplates.find((entry) => entry.slug === OWN_DOC);
    expect(own).toMatchObject({ locale: LOCALE, hasOwnLayout: true, isSystem: false });
    const served = (await usageOf(OTHER_LAYOUT)).usedByTemplates;
    expect(served.find((entry) => entry.slug === SECOND_DOC)).toMatchObject({ hasOwnLayout: true });
    expect(
      (await usageOf(LAYOUT)).usedByTemplates.find((entry) => entry.slug === SECOND_DOC),
    ).toMatchObject({
      status: "draft",
    });
    expect(served.find((entry) => entry.slug === SECOND_DOC)).toMatchObject({ status: "active" });
  });
});

describe("template-resolver :: validate emptyCompanyData", () => {
  test("names the company placeholders whose tenant value is empty", async () => {
    const result = await stack.http.queryOk<{ emptyCompanyData: string[] }>(
      TemplateResolverQueries.validate,
      {
        slug: "doc-company",
        kind: "document-pdf",
        locale: LOCALE,
        content: '<p><span data-variable="companyIban"></span></p>',
        contentFormat: "html",
        meta: {},
      },
      admin,
    );
    expect(result.emptyCompanyData).toContain("companyIban");
  });
});
