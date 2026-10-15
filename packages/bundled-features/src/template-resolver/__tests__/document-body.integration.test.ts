import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type DbConnection, fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTemplateResolverFeature } from "../feature.js";
import { collectionHandlerName, TemplateResolverHandlers } from "../qualified-names.js";
import { seedSystemTemplate } from "../seeding.js";
import {
  type TemplateResourceRow,
  templateResourceEntity,
  templateResourcesTable,
} from "../table.js";
import { documentBodyFixture } from "./document-body-fixture";

let stack: TestStack;
let db: DbConnection;

const systemAdmin = TestUsers.systemAdmin;
const tenantAdmin = createTestUser({ id: 2, roles: ["TenantAdmin"], tenantId: testTenantId(30) });
const agent = createTestUser({ id: 3, roles: ["Agent"], tenantId: testTenantId(30) });

const SNIPPETS_SET = collectionHandlerName("reply-snippets");

const feature = createTemplateResolverFeature({
  collections: [
    {
      id: "reply-snippets",
      kind: "document-pdf",
      access: { roles: ["Agent"] },
      nav: { label: "mail:nav.snippets" },
    },
  ],
});

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  db = stack.db;
  await unsafeCreateEntityTable(db, templateResourceEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

const pdfPayload = {
  slug: "contract",
  kind: "document-pdf" as const,
  locale: "de",
  contentFormat: "html" as const,
};

async function storedSystemRow(slug: string): Promise<TemplateResourceRow | undefined> {
  return fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
    tenantId: SYSTEM_TENANT_ID,
    slug,
    kind: "document-pdf",
    locale: "de",
  });
}

describe("template-resolver :: document body sanitizing", () => {
  test("upsertSystem rejects a script element and stores nothing", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.upsertSystem,
      { ...pdfPayload, slug: "evil", content: "<p>a</p><script>alert(1)</script>" },
      systemAdmin,
    );
    expect(err.code).toBe("validation_error");
    const fields = (err.details as { fields: Array<{ path: string; code: string }> }).fields;
    expect(fields).toContainEqual(
      expect.objectContaining({ path: "content", code: "script_element" }),
    );
    expect(await storedSystemRow("evil")).toBeUndefined();
  });

  test("upsertSystem stores a canonical body unchanged", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      { ...pdfPayload, slug: "canonical", content: documentBodyFixture },
      systemAdmin,
    );
    expect((await storedSystemRow("canonical"))?.content).toBe(documentBodyFixture);
  });

  test("upsertSystem stores the rebuilt body, not the submitted one", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      { ...pdfPayload, slug: "rebuilt", content: '<p class="x">Hi</p>' },
      systemAdmin,
    );
    expect((await storedSystemRow("rebuilt"))?.content).toBe("<p>Hi</p>");
  });

  test("upsertSystem rejects document-pdf with a non-html format", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.upsertSystem,
      { ...pdfPayload, slug: "wrong-format", contentFormat: "markdown", content: "# x" },
      systemAdmin,
    );
    const fields = (err.details as { fields: Array<{ code: string }> }).fields;
    expect(fields.map((field) => field.code)).toEqual(["document_requires_html_format"]);
  });

  test("upsertTenant rejects a javascript link", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.upsertTenant,
      {
        ...pdfPayload,
        slug: "tenant-evil",
        content: '<p><a href="javascript:x">go</a></p>',
      },
      tenantAdmin,
    );
    expect(err.code).toBe("validation_error");
    const fields = (err.details as { fields: Array<{ code: string }> }).fields;
    expect(fields.map((field) => field.code)).toEqual(["disallowed_link_href"]);
  });

  test("collection-set sanitizes an html body of a mail collection", async () => {
    await stack.http.writeOk(
      SNIPPETS_SET,
      {
        slug: "snippet",
        locale: "de",
        title: "Snippet",
        content: '<p style="color:red">Hi</p>',
        contentFormat: "html",
      },
      agent,
    );
    const row = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
      tenantId: agent.tenantId,
      slug: "snippet",
      kind: "document-pdf",
      locale: "de",
    });
    expect(row?.content).toBe("<p>Hi</p>");
  });

  test("collection-set rejects a hostile html body", async () => {
    const err = await stack.http.writeErr(
      SNIPPETS_SET,
      {
        slug: "snippet-evil",
        locale: "de",
        title: "Evil",
        content: '<p onclick="x()">Hi</p>',
        contentFormat: "html",
      },
      agent,
    );
    expect(err.code).toBe("validation_error");
  });

  test("seedSystemTemplate throws with the plain-text reason", async () => {
    await expect(
      seedSystemTemplate(db, {
        slug: "seed-evil",
        kind: "document-pdf",
        locale: "de",
        content: "<script>alert(1)</script>",
        contentFormat: "html",
      }),
    ).rejects.toThrow(
      "seedSystemTemplate seed-evil/document-pdf/de rejected: script_element (script)",
    );
  });
});
