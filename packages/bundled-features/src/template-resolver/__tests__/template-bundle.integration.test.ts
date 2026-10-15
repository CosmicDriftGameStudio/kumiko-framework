import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTemplateResolverFeature } from "../feature.js";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../qualified-names.js";
import { templateResourceEntity, templateResourcesTable } from "../table.js";

const tenantA = createTestUser({ id: 2, roles: ["TenantAdmin"], tenantId: testTenantId(10) });
const tenantB = createTestUser({ id: 3, roles: ["TenantAdmin"], tenantId: testTenantId(11) });
const systemTenantAdmin = createTestUser({
  id: 4,
  roles: ["SystemAdmin"],
  tenantId: SYSTEM_TENANT_ID,
});

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const bundle = {
  slug: "bundle-doc",
  kind: "document-pdf" as const,
  contentFormat: "html" as const,
  locales: {
    de: { body: '<p>Hallo</p><img data-resource="logo" alt="Logo">' },
    en: { body: '<p>Hello</p><img data-resource="logo" alt="Logo">' },
  },
  resources: { logo: { fileName: "logo.png", contentType: "image/png", base64: PNG_BASE64 } },
};

type ExportedBundle = {
  locales: Record<string, { body: string }>;
  resources: typeof bundle.resources;
};

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createFilesFeature(), createTemplateResolverFeature()],
    files: { storageProvider: createInMemoryFileProvider() },
  });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

const exportQuery = { slug: bundle.slug, kind: bundle.kind };

describe("template-resolver :: bundle", () => {
  test("import then export round-trips locales and resources, also across tenants", async () => {
    await stack.http.writeOk(TemplateResolverHandlers.importBundle, { bundle }, tenantA);
    const first = await stack.http.queryOk<ExportedBundle>(
      TemplateResolverQueries.exportBundle,
      exportQuery,
      tenantA,
    );
    expect(first.locales["de"]?.body).toBe(bundle.locales.de.body);
    expect(first.locales["en"]?.body).toBe(bundle.locales.en.body);
    expect(first.resources["logo"]).toEqual(bundle.resources.logo);

    await stack.http.writeOk(TemplateResolverHandlers.importBundle, { bundle: first }, tenantB);
    const second = await stack.http.queryOk<ExportedBundle>(
      TemplateResolverQueries.exportBundle,
      exportQuery,
      tenantB,
    );
    expect(second).toEqual(first);
  });

  test("an existing locale blocks a second import unless overwrite is set", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.importBundle,
      { bundle },
      tenantA,
    );
    const codes = (err.details as { fields: Array<{ code: string }> }).fields.map((f) => f.code);
    expect(codes).toContain("target_exists");
    await stack.http.writeOk(
      TemplateResolverHandlers.importBundle,
      { bundle, overwrite: true },
      tenantA,
    );
  });

  test("a system import with resources needs a system-tenant caller", async () => {
    const systemBundle = { ...bundle, slug: "bundle-system-doc" };
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.importBundleSystem,
      { bundle: systemBundle },
      TestUsers.systemAdmin,
    );
    const codes = (err.details as { fields: Array<{ code: string }> }).fields.map((f) => f.code);
    expect(codes).toContain("system_resources_need_system_tenant");
    await stack.http.writeOk(
      TemplateResolverHandlers.importBundleSystem,
      { bundle: systemBundle },
      systemTenantAdmin,
    );
  });

  test("an active system import with a publish issue in a later locale writes nothing and stores no file", async () => {
    const slug = "bundle-publish-gate";
    const gated = {
      ...bundle,
      slug,
      variableSchema: { name: { type: "text", required: true } },
      locales: {
        de: { body: '<p>Hallo <span data-variable="name"></span></p>' },
        en: { body: "<p>Hello</p>" },
      },
    };
    const fileRefsBefore = (await selectMany(stack.db, fileRefsTable)).length;
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.importBundleSystem,
      { bundle: gated },
      systemTenantAdmin,
    );
    const fields = (err.details as { fields: Array<{ code: string; path: string }> }).fields;
    expect(fields.map((f) => f.code)).toEqual(["missing_required_placeholder"]);
    expect(fields[0]?.path).toBe("locales.en.content");

    const rows = await selectMany(stack.db, templateResourcesTable, {
      tenantId: SYSTEM_TENANT_ID,
      slug,
    });
    expect(rows).toHaveLength(0);
    expect(await selectMany(stack.db, fileRefsTable)).toHaveLength(fileRefsBefore);
  });
});
