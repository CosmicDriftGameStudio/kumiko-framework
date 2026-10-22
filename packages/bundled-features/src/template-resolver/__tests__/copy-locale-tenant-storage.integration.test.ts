// A tenant's files can live in its own storage provider. copy-locale of a system template has to
// read the system files from the system tenant's provider, not from the caller's.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  type FileStorageProvider,
  fileRefsTable,
  withUploadLedger,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  buildMultipartBody,
  patchFileInstanceofForBunTest,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createTemplateResolverFeature } from "../feature.ts";
import { templateResourceEntity, templateResourcesTable } from "../table.ts";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../web/qualified-names.ts";
import { tenantEditableTemplates } from "./tenant-editable-fixture.ts";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const READABLE_SLUG = "copy-own-storage-readable";
const GONE_SLUG = "copy-own-storage-gone";

const systemAdmin = TestUsers.systemAdmin;
const tenantAdmin = createTestUser({ id: 2, roles: ["TenantAdmin"], tenantId: testTenantId(10) });

const systemProvider = createInMemoryFileProvider();
const tenantProvider = createInMemoryFileProvider();
const unusedProvider = createInMemoryFileProvider();

function providerOf(tenantId: string): FileStorageProvider {
  if (tenantId === SYSTEM_TENANT_ID) return systemProvider;
  return tenantId === tenantAdmin.tenantId ? tenantProvider : unusedProvider;
}

let stack: TestStack;

beforeAll(async () => {
  patchFileInstanceofForBunTest();
  stack = await setupTestStack({
    features: [
      createFilesFeature(),
      createTemplateResolverFeature({
        tenantEditable: tenantEditableTemplates(["mail"], [READABLE_SLUG, GONE_SLUG]),
      }),
    ],
    files: { storageProvider: unusedProvider },
    extraContext: (deps) => ({
      _fileProviderResolver: withUploadLedger(async (tenantId) => providerOf(tenantId), deps.db),
    }),
  });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

async function uploadPngAsSystemAdmin(): Promise<string> {
  const form = new FormData();
  form.append("file", new File([PNG_BYTES], "logo.png", { type: "image/png" }));
  const { body, contentType } = await buildMultipartBody(form);
  const res = await stack.app.request("/api/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await stack.jwt.sign(systemAdmin)}`,
      "Content-Type": contentType,
    },
    body,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function createSystemTemplateWithLogo(slug: string): Promise<string> {
  const created = await stack.http.writeOk<{ id: string }>(
    TemplateResolverHandlers.upsertSystem,
    {
      slug,
      kind: "mail",
      meta: { subject: "Hello" },
      locale: "de",
      content: "<p>Hello</p>",
      contentFormat: "html",
      variableSchema: {},
    },
    systemAdmin,
  );
  const logo = await stack.http.writeOk<{ fileRefId: string }>(
    TemplateResolverHandlers.resourceUpload,
    {
      sourceFileRefId: await uploadPngAsSystemAdmin(),
      templateId: created.id,
      key: "logo",
      tenantIdOverride: SYSTEM_TENANT_ID,
    },
    systemAdmin,
  );
  return logo.fileRefId;
}

const copyPayload = (slug: string) => ({
  slug,
  kind: "mail" as const,
  fromLocale: "de",
  toLocale: "en",
});

describe("copy-locale with one storage provider per tenant", () => {
  test("the system template's file is read from the system provider and stored in the caller's", async () => {
    await createSystemTemplateWithLogo(READABLE_SLUG);
    expect(tenantProvider.keys()).toHaveLength(0);

    const copied = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.copyLocale,
      copyPayload(READABLE_SLUG),
      tenantAdmin,
    );

    const found = await stack.http.queryOk<{ linkedResources: string }>(
      TemplateResolverQueries.findById,
      { id: copied.id },
      tenantAdmin,
    );
    expect(Object.keys(JSON.parse(found.linkedResources))).toEqual(["logo"]);
    expect(tenantProvider.keys()).toHaveLength(1);
  });

  test("a file whose row exists but whose bytes are unreadable fails the copy instead of dropping it", async () => {
    const sourceFileRefId = await createSystemTemplateWithLogo(GONE_SLUG);
    const [row] = await selectMany<{ storageKey: string }>(stack.db, fileRefsTable, {
      id: sourceFileRefId,
    });
    await systemProvider.delete(row?.storageKey ?? "missing");

    const error = await stack.http.writeErr(
      TemplateResolverHandlers.copyLocale,
      copyPayload(GONE_SLUG),
      tenantAdmin,
    );

    expect(error.httpStatus).toBe(422);
    expect(error.i18nKey).toBe("templateResolver.errors.resource.sourceUnreadable");
    const copies = await selectMany(stack.db, templateResourcesTable, {
      tenantId: tenantAdmin.tenantId,
      slug: GONE_SLUG,
    });
    expect(copies).toHaveLength(0);
  });
});
