import { afterAll, describe, expect, test } from "bun:test";
import {
  createAnonymousUser,
  defineFeature,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { seedRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createTemplateResolverApi } from "../api.ts";
import { createTemplateResolverFeature } from "../feature.ts";
import type { OverviewResponse } from "../index.ts";
import { templateResourceEntity, templateResourcesTable } from "../table.ts";
import {
  collectionHandlerName,
  TemplateResolverHandlers,
  TemplateResolverQueries,
} from "../web/qualified-names.ts";
import { tenantEditableTemplates } from "./tenant-editable-fixture.ts";

const MAIL_SLUG = "locked-ov:notify:welcome";
const PDF_SLUG = "locked-ov:invoice";
const LAYOUT_SLUG = "default";

const systemAdmin = TestUsers.systemAdmin;
// Same tenant as the SystemAdmin so the locked rows it writes are the tenant's own.
const tenantAdmin = createTestUser({
  id: 2,
  roles: ["TenantAdmin"],
  tenantId: systemAdmin.tenantId,
});
const tenantId = testTenantId(1);

const SYSTEM_LAYOUT =
  "<mjml><mj-body><mj-section><mj-column><mj-text>system layout</mj-text><mj-raw>{{{content}}}</mj-raw></mj-column></mj-section></mj-body></mjml>";
const TENANT_LAYOUT =
  "<div data-header><p>override layout</p></div><div data-content></div><div data-signature><p>Gruß</p></div><div data-footer><p>Impressum</p></div>";

function layoutDocument(scope: "system" | "override") {
  return {
    slug: LAYOUT_SLUG,
    kind: "mail-layout",
    locale: "en",
    contentFormat: scope === "system" ? ("mjml" as const) : ("html" as const),
    variableSchema: {},
    linkedResources: {},
    content: scope === "system" ? SYSTEM_LAYOUT : TENANT_LAYOUT,
    status: "active" as const,
    meta: {},
  };
}

function document(slug: string, kind: string, content: string) {
  if (kind === "mail-layout")
    return layoutDocument(content.startsWith("system") ? "system" : "override");
  return {
    slug,
    kind,
    locale: "de",
    contentFormat: "html" as const,
    variableSchema: {},
    linkedResources: {},
    content,
    status: "active" as const,
    ...(kind === "mail" ? { meta: { subject: "Betreff" } } : { meta: {} }),
  };
}

const DOCUMENTS = [
  [MAIL_SLUG, "mail"],
  [PDF_SLUG, "document-pdf"],
  [LAYOUT_SLUG, "mail-layout"],
] as const;

// Every template gets a system version and a tenant override, so only the lock decides who is served.
async function stackWith(
  editable: Parameters<typeof tenantEditableTemplates>,
): Promise<{ stack: TestStack; overrideIds: Record<string, string> }> {
  const stack = await setupTestStack({
    features: [
      createTemplateResolverFeature({ tenantEditable: tenantEditableTemplates(...editable) }),
    ],
  });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
  const overrideIds: Record<string, string> = {};
  for (const [slug, kind] of DOCUMENTS) {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      document(slug, kind, `system ${slug}`),
      systemAdmin,
    );
    const override = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      document(slug, kind, `override ${slug}`),
      systemAdmin,
    );
    overrideIds[slug] = override.id;
  }
  return { stack, overrideIds };
}

function resolveContent(stack: TestStack, slug: string, kind: "mail" | "document-pdf") {
  return createTemplateResolverApi(stack.db, stack.registry)
    .resolveTemplate({ tenantId, slug, kind, locale: "de" })
    .then((template) => template.content);
}

function resolveLayoutContent(stack: TestStack) {
  return createTemplateResolverApi(stack.db, stack.registry)
    .resolveLayout({ tenantId, slug: LAYOUT_SLUG, kind: "mail-layout", locale: "en" })
    .then((layout) => layout.content);
}

function overview(stack: TestStack, user: typeof tenantAdmin | typeof systemAdmin) {
  return stack.http.queryOk<OverviewResponse>(TemplateResolverQueries.overview, {}, user);
}

describe("locked template overrides :: mail free, linked PDF and layout locked", () => {
  let current: { stack: TestStack; overrideIds: Record<string, string> };
  const ready = stackWith([["mail"], [MAIL_SLUG]]).then((value) => {
    current = value;
  });
  afterAll(async () => {
    await ready;
    await current.stack.cleanup();
  });

  test("the unlocked mail serves the override, the locked PDF serves the system version", async () => {
    await ready;
    expect(await resolveContent(current.stack, MAIL_SLUG, "mail")).toContain(
      `override ${MAIL_SLUG}`,
    );
    expect(await resolveContent(current.stack, PDF_SLUG, "document-pdf")).toContain(
      `system ${PDF_SLUG}`,
    );
  });

  test("a locked layout override gives the system layout", async () => {
    await ready;
    expect(await resolveLayoutContent(current.stack)).toBe(SYSTEM_LAYOUT);
  });

  test("a SystemAdmin sees the locked override flagged and may reset it, the template-resolver queries do not show it to a TenantAdmin", async () => {
    await ready;
    const { stack, overrideIds } = current;
    const asSystemAdmin = await overview(stack, systemAdmin);
    const locked = asSystemAdmin.rows.find((row) => row.id === `document-pdf|${PDF_SLUG}`);
    expect(locked).toMatchObject({
      lockedOverride: true,
      origin: "system",
      lockedOverrideI18nKey: "templateResolver.overview.lockedOverride",
    });
    const free = asSystemAdmin.rows.find((row) => row.id === `mail|${MAIL_SLUG}`);
    expect(free).toMatchObject({ lockedOverride: false, origin: "tenant" });

    const asTenantAdmin = await overview(stack, tenantAdmin);
    expect(asTenantAdmin.rows.map((row) => row.id)).toEqual([`mail|${MAIL_SLUG}`]);
    expect(JSON.stringify(asTenantAdmin)).not.toContain('lockedOverride":true');

    const readById = (user: typeof tenantAdmin | typeof systemAdmin) =>
      stack.http.queryOk<{ slug: string } | null>(
        TemplateResolverQueries.findById,
        { id: overrideIds[PDF_SLUG] },
        user,
      );
    expect((await readById(systemAdmin))?.slug).toBe(PDF_SLUG);
    expect(await readById(tenantAdmin)).toBeNull();

    // The overview row carries the id the row action sends to resetToSystem.
    expect(locked?.lockedOverrideId).toBe(overrideIds[PDF_SLUG]);
    expect(free?.lockedOverrideId).toBeNull();
    expect(locked?.canResetLockedOverride).toBe(true);
    expect(free?.canResetLockedOverride).toBe(false);
    await stack.http.writeOk(
      TemplateResolverHandlers.resetToSystem,
      { id: locked?.lockedOverrideId },
      systemAdmin,
    );
    const afterReset = await overview(stack, systemAdmin);
    expect(
      afterReset.rows.find((row) => row.id === `document-pdf|${PDF_SLUG}`)?.lockedOverride,
    ).toBe(false);
  });
});

describe("locked template overrides :: no system version to fall back to", () => {
  const ORPHAN_SLUG = "locked-ov:orphan";
  let stack: TestStack;
  const ready = (async () => {
    stack = await setupTestStack({
      features: [
        createTemplateResolverFeature({
          tenantEditable: tenantEditableTemplates(["mail"], [MAIL_SLUG]),
        }),
      ],
    });
    await unsafeCreateEntityTable(stack.db, templateResourceEntity);
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      document(ORPHAN_SLUG, "document-pdf", `override ${ORPHAN_SLUG}`),
      systemAdmin,
    );
  })();
  afterAll(async () => {
    await ready;
    await stack.cleanup();
  });

  test("the row is flagged locked but offers no reset, because resetToSystem would be refused", async () => {
    await ready;
    const row = (await overview(stack, systemAdmin)).rows.find(
      (candidate) => candidate.id === `document-pdf|${ORPHAN_SLUG}`,
    );
    expect(row).toMatchObject({
      lockedOverride: true,
      lockedOverrideId: null,
      canResetLockedOverride: false,
    });
  });
});

describe("locked template overrides :: nothing unlocked, then unlocked", () => {
  test("a locked override gives the system version in mail and PDF", async () => {
    const { stack } = await stackWith([[], []]);
    try {
      expect(await resolveContent(stack, MAIL_SLUG, "mail")).toContain(`system ${MAIL_SLUG}`);
      expect(await resolveContent(stack, PDF_SLUG, "document-pdf")).toContain(`system ${PDF_SLUG}`);
    } finally {
      await stack.cleanup();
    }
  });

  test("after unlocking, the stored override is active again", async () => {
    const { stack } = await stackWith([
      ["mail", "document-pdf", "mail-layout"],
      [MAIL_SLUG, PDF_SLUG, LAYOUT_SLUG],
    ]);
    try {
      expect(await resolveContent(stack, MAIL_SLUG, "mail")).toContain(`override ${MAIL_SLUG}`);
      expect(await resolveContent(stack, PDF_SLUG, "document-pdf")).toContain(
        `override ${PDF_SLUG}`,
      );
      expect(await resolveLayoutContent(stack)).toBe(TENANT_LAYOUT);
    } finally {
      await stack.cleanup();
    }
  });
});

const USE_SLUG = "locked-use:notify:welcome";
const LOCKED_LAYOUT = "promo";
const BANNER_KEY = "banner";
const BANNER_FILE_REF = "00000000-0000-4000-8000-0000000000bb";

const lockedUse = defineFeature("locked-use", (r) => {
  r.writeHandler({
    name: "welcome",
    schema: z.object({}),
    access: { roles: ["TenantAdmin"] },
    handler: async () => ({ isSuccess: true as const, data: {} }),
  });
  r.notification("welcome", {
    trigger: { on: "welcome" },
    recipient: () => null,
    data: () => ({}),
    template: { de: { body: "<p>Willkommen</p>" } },
    meta: { de: { subject: "Willkommen" } },
  });
});

describe("locked template overrides :: side channels stay closed", () => {
  test("a locked row leaks neither its image keys nor its layout choice nor an exact lookup", async () => {
    const stack = await setupTestStack({
      features: [createTemplateResolverFeature(), lockedUse],
    });
    try {
      await unsafeCreateEntityTable(stack.db, templateResourceEntity);
      await seedRowViaEventStore(stack.db, templateResourcesTable, {
        tenantId,
        slug: USE_SLUG,
        kind: "mail",
        locale: "de",
        scope: "tenant",
        status: "active",
        content: "<p>Eigen</p>",
        contentFormat: "html",
        variableSchema: "{}",
        linkedResources: JSON.stringify({ [BANNER_KEY]: BANNER_FILE_REF }),
        meta: JSON.stringify({ subject: "Eigen", layoutSlug: LOCKED_LAYOUT }),
        insertedById: "test",
        modifiedById: "test",
      });

      const validation = await stack.http.queryOk<{ warnings: { detail: string }[] }>(
        TemplateResolverQueries.validate,
        {
          slug: USE_SLUG,
          kind: "mail",
          contentFormat: "html",
          content: `<p>Hallo</p><img data-resource="${BANNER_KEY}" alt="Banner">`,
          meta: { subject: "Betreff" },
          locale: "de",
        },
        tenantAdmin,
      );
      expect(validation.warnings.map((warning) => warning.detail)).toContain(BANNER_KEY);

      const usage = (layout: string) =>
        stack.http.queryOk<{ usedBy: { qualifiedName: string }[] }>(
          TemplateResolverQueries.usage,
          { slug: layout, kind: "mail-layout" },
          tenantAdmin,
        );
      expect((await usage(LOCKED_LAYOUT)).usedBy).toEqual([]);
      expect((await usage(LAYOUT_SLUG)).usedBy.map((entry) => entry.qualifiedName)).toContain(
        USE_SLUG,
      );

      const exact = await createTemplateResolverApi(stack.db, stack.registry).findExact({
        tenantId,
        slug: USE_SLUG,
        kind: "mail",
        locale: "de",
      });
      expect(exact).toBeNull();
    } finally {
      await stack.cleanup();
    }
  });

  test("document-blocks does not list the image keys of a locked row", async () => {
    const { stack } = await stackWith([[], []]);
    try {
      await stack.http.writeOk(
        TemplateResolverHandlers.upsertSystem,
        document("locked-ov:doc", "document-pdf", "system doc"),
        systemAdmin,
      );
      await seedRowViaEventStore(stack.db, templateResourcesTable, {
        tenantId,
        slug: "locked-ov:doc",
        kind: "document-pdf",
        locale: "de",
        scope: "tenant",
        status: "active",
        content: "<p>Eigen</p>",
        contentFormat: "html",
        variableSchema: "{}",
        linkedResources: JSON.stringify({ [BANNER_KEY]: BANNER_FILE_REF }),
        meta: "{}",
        insertedById: "test",
        modifiedById: "test",
      });
      const blocks = await stack.http.queryOk<{ resourceKeys: string[] }>(
        TemplateResolverQueries.documentBlocks,
        { slug: "locked-ov:doc", kind: "document-pdf", locale: "de" },
        tenantAdmin,
      );
      expect(blocks.resourceKeys).not.toContain(BANNER_KEY);
    } finally {
      await stack.cleanup();
    }
  });
});

describe("locked template overrides :: a collection does not open system templates", () => {
  const SNIPPETS_SET = collectionHandlerName("reply-snippets");
  const SHADOWED_SLUG = "shadowed-pdf";
  const FREE_SLUG = "free-snippet";
  const entry = (slug: string, content: string) => ({
    slug,
    locale: "de",
    title: "Eintrag",
    content,
    contentFormat: "html" as const,
  });

  async function collectionStack() {
    const stack = await setupTestStack({
      features: [
        createTemplateResolverFeature({
          collections: [
            {
              id: "reply-snippets",
              kind: "document-pdf",
              contentFormat: "document",
              access: { roles: ["TenantAdmin"] },
              nav: { label: "x:nav.snippets" },
            },
          ],
        }),
      ],
    });
    await unsafeCreateEntityTable(stack.db, templateResourceEntity);
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      document(SHADOWED_SLUG, "document-pdf", "system pdf"),
      systemAdmin,
    );
    return stack;
  }

  test("collection-set refuses a slug that has a system template outside tenantEditable", async () => {
    const stack = await collectionStack();
    try {
      const error = await stack.http.writeErr(
        SNIPPETS_SET,
        entry(SHADOWED_SLUG, "<p>Tenant</p>"),
        tenantAdmin,
      );
      expect(error.code).toBe("access_denied");
      expect(await resolveContent(stack, SHADOWED_SLUG, "document-pdf")).toContain("system pdf");
    } finally {
      await stack.cleanup();
    }
  });

  test("a stored collection row does not shadow the system template, a plain entry is delivered", async () => {
    const stack = await collectionStack();
    try {
      await seedRowViaEventStore(stack.db, templateResourcesTable, {
        tenantId,
        slug: SHADOWED_SLUG,
        kind: "document-pdf",
        locale: "de",
        scope: "tenant",
        status: "active",
        content: "<p>Tenant</p>",
        contentFormat: "html",
        variableSchema: "{}",
        linkedResources: "{}",
        meta: "{}",
        insertedById: "test",
        modifiedById: "test",
      });
      expect(await resolveContent(stack, SHADOWED_SLUG, "document-pdf")).toContain("system pdf");

      await stack.http.writeOk(
        SNIPPETS_SET,
        entry(FREE_SLUG, "<p>Freier Eintrag</p>"),
        tenantAdmin,
      );
      expect(await resolveContent(stack, FREE_SLUG, "document-pdf")).toContain("Freier Eintrag");
    } finally {
      await stack.cleanup();
    }
  });
});

describe("locked template overrides :: public text-block paths follow the same rule", () => {
  test("a collection text-block that shadows a system block is not served anonymously", async () => {
    const stack = await setupTestStack({
      features: [
        createTemplateResolverFeature({
          collections: [
            {
              id: "pages",
              kind: "text-block",
              access: { roles: ["TenantAdmin"] },
              nav: { label: "x:nav.pages" },
            },
          ],
        }),
      ],
    });
    try {
      await unsafeCreateEntityTable(stack.db, templateResourceEntity);
      const block = (blockTenantId: string, slug: string, content: string) =>
        seedRowViaEventStore(stack.db, templateResourcesTable, {
          tenantId: blockTenantId,
          slug,
          kind: "text-block",
          locale: "de",
          scope: blockTenantId === SYSTEM_TENANT_ID ? "system" : "tenant",
          status: "active",
          title: slug,
          content,
          contentFormat: "markdown",
          variableSchema: "{}",
          linkedResources: "{}",
          meta: "{}",
          insertedById: "test",
          modifiedById: "test",
        });
      await block(SYSTEM_TENANT_ID, "imprint", "System-Impressum");
      await block(tenantId, "imprint", "Tenant-Impressum");
      await block(tenantId, "about", "Ueber uns");

      const anonymous = createAnonymousUser(tenantId);
      const bySlug = (slug: string) =>
        stack.http.queryOk<{ content: string } | null>(
          TemplateResolverQueries.bySlug,
          { slug, locale: "de" },
          anonymous,
        );
      expect(await bySlug("imprint")).toBeNull();
      expect((await bySlug("about"))?.content).toBe("Ueber uns");

      const listed = await stack.http.queryOk<{ blocks: { slug: string }[] }>(
        TemplateResolverQueries.byTenant,
        {},
        anonymous,
      );
      expect(listed.blocks.map((entry) => entry.slug)).toEqual(["about"]);
    } finally {
      await stack.cleanup();
    }
  });
});
