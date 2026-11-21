// Variants of a PDF template run through the real write pipeline; nothing is mocked.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-testing/helpers";
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
import { createTemplateResolverApi } from "../api.ts";
import { createTemplateResolverFeature } from "../feature.ts";
import { seedSystemTemplate } from "../seeding.ts";
import {
  type TemplateResourceRow,
  templateResourceEntity,
  templateResourcesTable,
} from "../table.ts";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../web/qualified-names.ts";

const LOCALE = "de";
const BASE = "contract";
const PLAIN_BASE = "plain-contract";
const IMAGED_BASE = "imaged-contract";
const LONG_BASE = `contract-${"x".repeat(100)}`;
const LOGO_FILE_REF = "00000000-0000-4000-8000-0000000000f1";
const SYSTEM_VARIANT = `${BASE}:commercial`;
const BASE_CONTENT = '<p>Vertrag <span data-variable="customer"></span></p>';
const VARIABLE_SCHEMA = { customer: { type: "text", required: true } };

const admin = createTestUser({ id: 1, roles: ["TenantAdmin"], tenantId: testTenantId(1) });
const otherAdmin = createTestUser({ id: 2, roles: ["TenantAdmin"], tenantId: testTenantId(2) });

type Created = { slug: string; locale: string; kind: string; title: string; base: BaseRef };
type BaseRef = { scope: string; version: number };
type Blocks = { base: BaseRef; status: string; meta: Record<string, unknown> };
type Variant = { slug: string; title: string | null; scope: string; locale: string };
type PublishResult = { published: unknown[]; failed: { slug: string; reason: string }[] };

async function boot(tenantEditable: Parameters<typeof createTemplateResolverFeature>[0]) {
  const stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createTemplateResolverFeature(tenantEditable),
    ],
    extraContext: () => ({ configResolver: createConfigResolver() }),
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
  for (const slug of [BASE, PLAIN_BASE]) {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      {
        slug,
        kind: "document-pdf",
        locale: LOCALE,
        content: BASE_CONTENT,
        contentFormat: "html",
        variableSchema: VARIABLE_SCHEMA,
        linkedResources: {},
      },
      TestUsers.systemAdmin,
    );
  }
  await seedSystemTemplate(stack.db, {
    slug: IMAGED_BASE,
    kind: "document-pdf",
    locale: LOCALE,
    content: BASE_CONTENT,
    contentFormat: "html",
    variableSchema: VARIABLE_SCHEMA,
    linkedResources: { logo: LOGO_FILE_REF },
  });
  await seedSystemTemplate(stack.db, {
    slug: SYSTEM_VARIANT,
    variantOf: BASE,
    kind: "document-pdf",
    locale: LOCALE,
    content: BASE_CONTENT,
    contentFormat: "html",
    variableSchema: VARIABLE_SCHEMA,
    title: "Gewerbe",
  });
  return stack;
}

const variantsOf = (stack: TestStack, user: typeof admin) =>
  stack.http.queryOk<Variant[]>(
    TemplateResolverQueries.variants,
    { baseSlug: BASE, locale: LOCALE },
    user,
  );

const blocksOf = (stack: TestStack, slug: string, user: typeof admin) =>
  stack.http.queryOk<Blocks>(
    TemplateResolverQueries.documentBlocks,
    { slug, kind: "document-pdf", locale: LOCALE },
    user,
  );

describe("template-resolver :: variants", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await boot({
      tenantEditable: [
        { kind: "document-pdf", slug: BASE, access: { roles: ["TenantAdmin"] }, variants: true },
        { kind: "document-pdf", slug: PLAIN_BASE, access: { roles: ["TenantAdmin"] } },
        {
          kind: "document-pdf",
          slug: LONG_BASE,
          access: { roles: ["TenantAdmin"] },
          variants: true,
        },
        {
          kind: "document-pdf",
          slug: IMAGED_BASE,
          access: { roles: ["TenantAdmin"] },
          variants: true,
        },
      ],
    });
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("create-variant copies the base as a tenant draft, patch-draft edits it, publish makes it listed for its tenant only", async () => {
    const created = await stack.http.writeOk<Created>(
      TemplateResolverHandlers.createVariant,
      { baseSlug: BASE, name: "furnished", title: "Möbliert", locale: LOCALE },
      admin,
    );
    expect(created).toMatchObject({
      slug: `${BASE}:furnished`,
      kind: "document-pdf",
      title: "Möbliert",
      base: { scope: "tenant" },
    });

    const row = await fetchOne<TemplateResourceRow>(stack.db, templateResourcesTable, {
      tenantId: admin.tenantId,
      slug: created.slug,
      kind: "document-pdf",
    });
    expect(row?.status).toBe("draft");
    expect(row?.title).toBe("Möbliert");
    expect(JSON.parse(row?.variableSchema ?? "{}")).toEqual(VARIABLE_SCHEMA);
    expect(JSON.parse(row?.meta ?? "{}")).toMatchObject({ variantOf: BASE });
    expect(row?.content).toContain("Vertrag");

    expect((await variantsOf(stack, admin)).map((variant) => variant.slug)).toEqual([
      SYSTEM_VARIANT,
    ]);

    await stack.http.writeOk(
      TemplateResolverHandlers.patchDraft,
      {
        slug: created.slug,
        kind: "document-pdf",
        locale: LOCALE,
        base: created.base,
        ops: [
          {
            op: "replaceBody",
            blocks: [
              { type: "heading", level: 1, text: "Möblierter Mietvertrag" },
              { type: "paragraph", text: "Kunde {{customer}}" },
            ],
          },
        ],
      },
      admin,
    );
    const afterPatch = await blocksOf(stack, created.slug, admin);
    expect(afterPatch.status).toBe("draft");
    expect(afterPatch.meta["variantOf"]).toBe(BASE);
  });

  test("a variant without the required placeholder cannot be published, with it it can", async () => {
    const created = await stack.http.writeOk<Created>(
      TemplateResolverHandlers.createVariant,
      { baseSlug: BASE, name: "garage", title: "Garage", locale: LOCALE },
      admin,
    );
    const ref = { slug: created.slug, kind: "document-pdf", locale: LOCALE };
    const published = await stack.http.writeOk<PublishResult>(
      TemplateResolverHandlers.publishTemplates,
      { templates: [ref] },
      admin,
    );
    expect(published.published).toHaveLength(1);

    const withoutPlaceholder = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: `${BASE}:empty`,
        kind: "document-pdf",
        locale: LOCALE,
        content: "<p>Kein Platzhalter</p>",
        contentFormat: "html",
        meta: { variantOf: BASE },
        variableSchema: VARIABLE_SCHEMA,
        status: "draft",
      },
      admin,
    );
    expect(withoutPlaceholder.id).toBeTruthy();
    const blocked = await stack.http.writeOk<PublishResult>(
      TemplateResolverHandlers.publishTemplates,
      { templates: [{ slug: `${BASE}:empty`, kind: "document-pdf", locale: LOCALE }] },
      admin,
    );
    expect(blocked.published).toHaveLength(0);
    expect(blocked.failed.map((failure) => failure.slug)).toEqual([`${BASE}:empty`]);
  });

  test("the variants query lists system and own active variants, separated per tenant", async () => {
    const own = await variantsOf(stack, admin);
    expect(own).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slug: SYSTEM_VARIANT, scope: "system", title: "Gewerbe" }),
        expect.objectContaining({ slug: `${BASE}:garage`, scope: "tenant", title: "Garage" }),
      ]),
    );
    expect(own.map((variant) => variant.slug)).not.toContain(`${BASE}:furnished`);
    expect(own.map((variant) => variant.slug)).not.toContain(`${BASE}:empty`);

    expect((await variantsOf(stack, otherAdmin)).map((variant) => variant.slug)).toEqual([
      SYSTEM_VARIANT,
    ]);
  });

  test("the variants query is open to a user with an app-owned role, scoped to their own tenant", async () => {
    const propertyManager = createTestUser({
      id: 3,
      roles: ["propertyManager"],
      tenantId: admin.tenantId,
    });
    const slugs = (await variantsOf(stack, propertyManager)).map((variant) => variant.slug);
    expect(slugs).toEqual(expect.arrayContaining([SYSTEM_VARIANT, `${BASE}:garage`]));

    const foreignManager = createTestUser({
      id: 4,
      roles: ["propertyManager"],
      tenantId: otherAdmin.tenantId,
    });
    expect((await variantsOf(stack, foreignManager)).map((variant) => variant.slug)).toEqual([
      SYSTEM_VARIANT,
    ]);
  });

  test("the resolver serves the published tenant variant to its tenant only", async () => {
    const api = createTemplateResolverApi(stack.db, stack.registry);
    const request = { slug: `${BASE}:garage`, kind: "document-pdf" as const, locale: LOCALE };
    const own = await api.resolveTemplate({ tenantId: admin.tenantId, ...request });
    expect(own.scope).toBe("tenant");
    await expect(
      api.resolveTemplate({ tenantId: otherAdmin.tenantId, ...request }),
    ).rejects.toThrow();
  });

  test("setVariable on a variant is refused and its variables stay the base's", async () => {
    const slug = `${BASE}:garage`;
    const current = await blocksOf(stack, slug, admin);
    const error = await stack.http.writeErr(
      TemplateResolverHandlers.patchDraft,
      {
        slug,
        kind: "document-pdf",
        locale: LOCALE,
        base: current.base,
        ops: [{ op: "setVariable", name: "extra", definition: { type: "text" } }],
      },
      admin,
    );
    expectErrorIncludes(error, "variables_inherited_from_base");
  });

  test("setMeta cannot move or drop variantOf", async () => {
    const slug = `${BASE}:garage`;
    const current = await blocksOf(stack, slug, admin);
    const error = await stack.http.writeErr(
      TemplateResolverHandlers.patchDraft,
      {
        slug,
        kind: "document-pdf",
        locale: LOCALE,
        base: current.base,
        ops: [{ op: "setMeta", meta: { variantOf: null } }],
      },
      admin,
    );
    expectErrorIncludes(error, "variant_of_immutable");
  });

  test("create-variant is refused for a base without variants, also for a TenantAdmin and a SystemAdmin", async () => {
    for (const user of [admin, TestUsers.systemAdmin]) {
      const error = await stack.http.writeErr(
        TemplateResolverHandlers.createVariant,
        { baseSlug: PLAIN_BASE, name: "x", title: "X", locale: LOCALE },
        user,
      );
      expectErrorIncludes(error, "variants_not_enabled");
    }
  });

  test("create-variant carries the base's linked images into the variant", async () => {
    const created = await stack.http.writeOk<Created>(
      TemplateResolverHandlers.createVariant,
      { baseSlug: IMAGED_BASE, name: "copy", title: "Kopie", locale: LOCALE },
      admin,
    );
    const row = await fetchOne<TemplateResourceRow>(stack.db, templateResourcesTable, {
      tenantId: admin.tenantId,
      slug: created.slug,
      kind: "document-pdf",
    });
    expect(JSON.parse(row?.linkedResources ?? "{}")).toEqual({ logo: LOGO_FILE_REF });
  });

  test("a write of a variant row with another variable schema than its base is refused", async () => {
    const error = await stack.http.writeErr(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: `${BASE}:drift`,
        kind: "document-pdf",
        locale: LOCALE,
        content: BASE_CONTENT,
        contentFormat: "html",
        meta: { variantOf: BASE },
        variableSchema: { customer: { type: "text", required: true }, extra: { type: "text" } },
      },
      admin,
    );
    expectErrorIncludes(error, "variables_inherited_from_base");
  });

  test("a variant in a locale the base does not exist in still inherits the base's fallback-locale schema", async () => {
    const error = await stack.http.writeErr(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: `${BASE}:drift-en`,
        kind: "document-pdf",
        locale: "en",
        content: BASE_CONTENT,
        contentFormat: "html",
        meta: { variantOf: BASE },
        variableSchema: { customer: { type: "text", required: true }, extra: { type: "text" } },
      },
      admin,
    );
    expectErrorIncludes(error, "variables_inherited_from_base");
  });

  test("a variant follows a base that gains a required variable: patch-draft re-syncs, publish gates on it", async () => {
    const created = await stack.http.writeOk<Created>(
      TemplateResolverHandlers.createVariant,
      { baseSlug: IMAGED_BASE, name: "follow", title: "Follow", locale: LOCALE },
      admin,
    );
    const grownSchema = { ...VARIABLE_SCHEMA, contact: { type: "text", required: true } };
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      {
        slug: IMAGED_BASE,
        kind: "document-pdf",
        locale: LOCALE,
        content:
          '<p><span data-variable="customer"></span><span data-variable="contact"></span></p>',
        contentFormat: "html",
        variableSchema: grownSchema,
        linkedResources: { logo: LOGO_FILE_REF },
      },
      TestUsers.systemAdmin,
    );

    await stack.http.writeOk(
      TemplateResolverHandlers.patchDraft,
      {
        slug: created.slug,
        kind: "document-pdf",
        locale: LOCALE,
        base: created.base,
        ops: [
          {
            op: "replaceBody",
            blocks: [{ type: "paragraph", text: "Kunde {{customer}}" }],
          },
        ],
      },
      admin,
    );
    const row = await fetchOne<TemplateResourceRow>(stack.db, templateResourcesTable, {
      tenantId: admin.tenantId,
      slug: created.slug,
      kind: "document-pdf",
      locale: LOCALE,
    });
    expect(JSON.parse(row?.variableSchema ?? "{}")).toEqual(grownSchema);

    const published = await stack.http.writeOk<PublishResult>(
      TemplateResolverHandlers.publishTemplates,
      { templates: [{ slug: created.slug, kind: "document-pdf", locale: LOCALE }] },
      admin,
    );
    expect(published.published).toHaveLength(0);
    expect(published.failed.map((failure) => failure.slug)).toEqual([created.slug]);
  });

  test("create-variant is refused for a base the app does not list", async () => {
    const error = await stack.http.writeErr(
      TemplateResolverHandlers.createVariant,
      { baseSlug: "unlisted-doc", name: "x", title: "X", locale: LOCALE },
      admin,
    );
    expectErrorIncludes(error, "template_not_tenant_editable");
  });

  test("create-variant refuses an existing slug and a name that is not one kebab segment", async () => {
    expectErrorIncludes(
      await stack.http.writeErr(
        TemplateResolverHandlers.createVariant,
        { baseSlug: BASE, name: "garage", title: "Garage", locale: LOCALE },
        admin,
      ),
      "variant_exists",
    );
    for (const name of ["a:b", "Garage", "x".repeat(41)]) {
      const error = await stack.http.writeErr(
        TemplateResolverHandlers.createVariant,
        { baseSlug: BASE, name, title: "X", locale: LOCALE },
        admin,
      );
      expect(error.httpStatus).toBe(400);
    }
  });

  test("create-variant builds the name from the title when none is given and defaults the locale", async () => {
    const created = await stack.http.writeOk<Created>(
      TemplateResolverHandlers.createVariant,
      { baseSlug: BASE, name: "", title: "Gewerbe-Mietvertrag Süd" },
      admin,
    );
    expect(created.slug).toBe(`${BASE}:gewerbe-mietvertrag-sued`);
    expect(created.locale).toBe(LOCALE);

    expectErrorIncludes(
      await stack.http.writeErr(
        TemplateResolverHandlers.createVariant,
        { baseSlug: BASE, title: "!!!" },
        admin,
      ),
      "variant_name_invalid",
    );
  });

  test("create-variant refuses a name that makes the variant slug longer than a slug may be", async () => {
    expectErrorIncludes(
      await stack.http.writeErr(
        TemplateResolverHandlers.createVariant,
        { baseSlug: LONG_BASE, name: "abcdefghijklmnopqrst", title: "Lang", locale: LOCALE },
        admin,
      ),
      "variant_name_invalid",
    );
  });

  test("a tenant write under <base>:<name> without meta.variantOf is refused", async () => {
    const error = await stack.http.writeErr(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: `${BASE}:x`,
        kind: "document-pdf",
        locale: LOCALE,
        content: BASE_CONTENT,
        contentFormat: "html",
        variableSchema: VARIABLE_SCHEMA,
      },
      admin,
    );
    expectErrorIncludes(error, "invalid_variant_of");
  });

  test("a system template that only has the slug shape of a variant is not overridable by the tenant", async () => {
    const standalone = `${BASE}:standalone`;
    await seedSystemTemplate(stack.db, {
      slug: standalone,
      kind: "document-pdf",
      locale: LOCALE,
      content: BASE_CONTENT,
      contentFormat: "html",
      variableSchema: VARIABLE_SCHEMA,
    });
    const error = await stack.http.writeErr(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: standalone,
        kind: "document-pdf",
        locale: LOCALE,
        content: BASE_CONTENT,
        contentFormat: "html",
        variableSchema: VARIABLE_SCHEMA,
      },
      admin,
    );
    expectErrorIncludes(error, "invalid_variant_of");
    const resolved = await createTemplateResolverApi(stack.db, stack.registry).resolveTemplate({
      tenantId: admin.tenantId,
      slug: standalone,
      kind: "document-pdf",
      locale: LOCALE,
    });
    expect(resolved.scope).toBe("system");
    expect((await variantsOf(stack, admin)).map((variant) => variant.slug)).not.toContain(
      standalone,
    );
  });

  test("the overview flags a base that allows variants and lists its variants right after it", async () => {
    const { rows } = await stack.http.queryOk<{
      rows: { slug: string; variantOf: string | null; variantsEnabled: boolean }[];
    }>(
      TemplateResolverQueries.overview,
      { filters: [{ field: "kind", op: "in", value: ["document-pdf"] }] },
      admin,
    );
    const slugs = rows.map((row) => row.slug);
    const baseAt = slugs.indexOf(BASE);
    expect(rows[baseAt]).toMatchObject({ variantOf: null, variantsEnabled: true });
    expect(rows.find((row) => row.slug === PLAIN_BASE)).toMatchObject({ variantsEnabled: false });
    const variants = rows.filter((row) => row.variantOf === BASE);
    expect(variants.length).toBeGreaterThan(0);
    expect(slugs.slice(baseAt + 1, baseAt + 1 + variants.length).toSorted()).toEqual(
      variants.map((row) => row.slug).toSorted(),
    );
    expect(variants.every((row) => !row.variantsEnabled)).toBe(true);
  });

  test("a mail sharing the base's slug does not pull the variants under it a second time", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      {
        slug: BASE,
        kind: "mail",
        meta: { subject: "Vertrag" },
        locale: LOCALE,
        content: "<p>Vertrag</p>",
        contentFormat: "html",
        variableSchema: {},
      },
      TestUsers.systemAdmin,
    );
    const { rows, total } = await stack.http.queryOk<{
      rows: { id: string; slug: string; kind: string; variantOf: string | null }[];
      total: number;
    }>(TemplateResolverQueries.overview, {}, TestUsers.systemAdmin);
    expect(
      rows
        .filter((row) => row.slug === BASE)
        .map((row) => row.kind)
        .toSorted(),
    ).toEqual(["document-pdf", "mail"]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(rows.length).toBe(total);
    const pdfBaseAt = rows.findIndex((row) => row.slug === BASE && row.kind === "document-pdf");
    expect(rows[pdfBaseAt + 1]?.variantOf).toBe(BASE);
  });
});

describe("template-resolver :: variants follow the base entry", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await boot({
      tenantEditable: [
        { kind: "document-pdf", slug: PLAIN_BASE, access: { roles: ["TenantAdmin"] } },
      ],
    });
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      {
        slug: `${BASE}:locked`,
        kind: "document-pdf",
        locale: LOCALE,
        content: BASE_CONTENT,
        contentFormat: "html",
        meta: { variantOf: BASE },
        variableSchema: VARIABLE_SCHEMA,
        tenantIdOverride: admin.tenantId,
        status: "active",
        title: "Gesperrt",
      },
      TestUsers.systemAdmin,
    );
  });

  afterAll(async () => {
    await stack.cleanup();
  });

  test("a tenant variant of a base that is not tenantEditable is not listed or served", async () => {
    expect((await variantsOf(stack, admin)).map((variant) => variant.slug)).toEqual([
      SYSTEM_VARIANT,
    ]);
    const api = createTemplateResolverApi(stack.db, stack.registry);
    const resolved = await api
      .resolveTemplate({
        tenantId: admin.tenantId,
        slug: `${BASE}:locked`,
        kind: "document-pdf",
        locale: LOCALE,
      })
      .catch(() => null);
    expect(resolved).toBeNull();
  });

  test("a TenantAdmin cannot create a variant or edit one of a locked base", async () => {
    expectErrorIncludes(
      await stack.http.writeErr(
        TemplateResolverHandlers.createVariant,
        { baseSlug: BASE, name: "x", title: "X", locale: LOCALE },
        admin,
      ),
      "template_not_tenant_editable",
    );
  });
});
