import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createEventStoreExecutor,
  createTenantDb,
  fetchOne,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { rebuildProjection } from "@cosmicdrift/kumiko-framework/pipeline";
import { createTestUser } from "@cosmicdrift/kumiko-framework/seeding";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createManagedPagesFeature } from "../feature.ts";
import { BODY_REJECTED_I18N_KEY } from "../handlers/page-body-issues.ts";
import { seedPage } from "../seeding.ts";
import { type PageRow, pageEntity, pagesTable } from "../table.ts";

const TENANT_A = "11111111-1111-4111-8111-111111111111";

const adminA = createTestUser({ id: 20, roles: ["TenantAdmin"], tenantId: TENANT_A });

const managed = createManagedPagesFeature({
  resolveApexTenant: (host) => (host.startsWith("a.") ? TENANT_A : null),
});

const DOCUMENT_BODY = "<p>Hello <strong>document</strong> world</p>";
const SCRIPT_BODY = "<p>ok</p><script>alert(1)</script>";

let stack: TestStack;

beforeAll(async () => {
  const resolver = createConfigResolver();
  stack = await setupTestStack({
    features: [createConfigFeature(), managed],
    anonymousAccess: { tenantExists: async (id) => id === TENANT_A },
    extraContext: ({ registry }) => ({
      configResolver: resolver,
      configAccessorFactory: createConfigAccessorFactory(registry, resolver),
    }),
  });
  await unsafeCreateEntityTable(stack.db, pageEntity);
  await unsafePushTables(stack.db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

async function publicHtml(slug: string): Promise<{ status: number; html: string }> {
  const res = await stack.app.request(`http://a.example.com/p/${slug}`);
  return { status: res.status, html: await res.text() };
}

async function pageBySlug(slug: string): Promise<PageRow | null> {
  const row = await fetchOne<PageRow>(stack.db, pagesTable, {
    tenantId: TENANT_A,
    slug,
    lang: "en",
  });
  return row ?? null;
}

describe("managed-pages :: document bodies (create)", () => {
  test("a document page is stored as document and served as sanitized HTML", async () => {
    await stack.http.writeOk(
      "managed-pages:write:page:create",
      {
        slug: "doc-create",
        lang: "en",
        title: "Doc",
        body: DOCUMENT_BODY,
        bodyFormat: "document",
        published: true,
      },
      adminA,
    );
    expect((await pageBySlug("doc-create"))?.bodyFormat).toBe("document");

    const { status, html } = await publicHtml("doc-create");
    expect(status).toBe(200);
    expect(html).toContain("<strong>document</strong>");
    // Markdown rendering would have escaped the tags as text.
    expect(html).not.toContain("&lt;strong&gt;");
  });

  test("a markdown page created without bodyFormat renders as before", async () => {
    await stack.http.writeOk(
      "managed-pages:write:page:create",
      { slug: "md-create", lang: "en", title: "MD", body: "# Hi **there**", published: true },
      adminA,
    );
    expect((await pageBySlug("md-create"))?.bodyFormat).toBe("markdown");
    const { html } = await publicHtml("md-create");
    expect(html).toContain("<strong>there</strong>");
    expect(html).toContain("<h1");
  });

  test("a rejected document body is a field error on body and nothing is stored", async () => {
    const error = await stack.http.writeErr(
      "managed-pages:write:page:create",
      {
        slug: "doc-bad",
        lang: "en",
        title: "Bad",
        body: SCRIPT_BODY,
        bodyFormat: "document",
        published: true,
      },
      adminA,
    );
    expectErrorIncludes(error, BODY_REJECTED_I18N_KEY);
    expectErrorIncludes(error, '"path":"body"');
    expect(await pageBySlug("doc-bad")).toBeNull();
  });

  test("a script in a markdown body is still accepted (escaped on render)", async () => {
    await stack.http.writeOk(
      "managed-pages:write:page:create",
      { slug: "md-script", lang: "en", title: "MD script", body: SCRIPT_BODY, published: true },
      adminA,
    );
    const { html } = await publicHtml("md-script");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});

describe("managed-pages :: document bodies (update)", () => {
  async function createMarkdownPage(slug: string, body: string) {
    await stack.http.writeOk(
      "managed-pages:write:page:create",
      { slug, lang: "en", title: slug, body, published: true },
      adminA,
    );
    const row = await pageBySlug(slug);
    if (row === null) throw new Error(`page ${slug} missing`);
    return row;
  }

  test("converting to document with body and bodyFormat in one update", async () => {
    const row = await createMarkdownPage("upd-convert", "old **markdown**");
    await stack.http.writeOk(
      "managed-pages:write:page:update",
      {
        id: row.id,
        version: row.version,
        changes: { body: DOCUMENT_BODY, bodyFormat: "document" },
      },
      adminA,
    );
    const { html } = await publicHtml("upd-convert");
    expect(html).toContain("<strong>document</strong>");
  });

  test("an invalid document body in an update is rejected as a field error", async () => {
    const row = await createMarkdownPage("upd-bad", "fine");
    const error = await stack.http.writeErr(
      "managed-pages:write:page:update",
      {
        id: row.id,
        version: row.version,
        changes: { body: SCRIPT_BODY, bodyFormat: "document" },
      },
      adminA,
    );
    expectErrorIncludes(error, BODY_REJECTED_I18N_KEY);
    expect((await pageBySlug("upd-bad"))?.body).toBe("fine");
  });

  test("switching only bodyFormat re-checks the stored body", async () => {
    // Stored as markdown, so the script is legal until the format flips.
    const row = await createMarkdownPage("upd-flip", SCRIPT_BODY);
    const error = await stack.http.writeErr(
      "managed-pages:write:page:update",
      { id: row.id, version: row.version, changes: { bodyFormat: "document" } },
      adminA,
    );
    expectErrorIncludes(error, BODY_REJECTED_I18N_KEY);
    expect((await pageBySlug("upd-flip"))?.bodyFormat).toBe("markdown");
  });

  test("editing only the body of a document page is checked as document", async () => {
    await stack.http.writeOk(
      "managed-pages:write:page:create",
      {
        slug: "upd-doc-body",
        lang: "en",
        title: "x",
        body: DOCUMENT_BODY,
        bodyFormat: "document",
        published: true,
      },
      adminA,
    );
    const row = await pageBySlug("upd-doc-body");
    if (row === null) throw new Error("page missing");
    const error = await stack.http.writeErr(
      "managed-pages:write:page:update",
      { id: row.id, version: row.version, changes: { body: SCRIPT_BODY } },
      adminA,
    );
    expectErrorIncludes(error, BODY_REJECTED_I18N_KEY);
  });
});

describe("managed-pages :: set with bodyFormat", () => {
  test("document via set, and omitting bodyFormat later resets to markdown", async () => {
    await stack.http.writeOk(
      "managed-pages:write:set",
      {
        slug: "set-doc",
        lang: "en",
        title: "Set",
        body: DOCUMENT_BODY,
        bodyFormat: "document",
        published: true,
      },
      adminA,
    );
    expect((await pageBySlug("set-doc"))?.bodyFormat).toBe("document");
    expect((await publicHtml("set-doc")).html).toContain("<strong>document</strong>");

    await stack.http.writeOk(
      "managed-pages:write:set",
      { slug: "set-doc", lang: "en", title: "Set", body: "plain **markdown**" },
      adminA,
    );
    expect((await pageBySlug("set-doc"))?.bodyFormat).toBe("markdown");
    expect((await publicHtml("set-doc")).html).toContain("<strong>markdown</strong>");
  });

  test("set without bodyFormat stays markdown", async () => {
    await stack.http.writeOk(
      "managed-pages:write:set",
      { slug: "set-md", lang: "en", title: "Set", body: "# Title", published: true },
      adminA,
    );
    expect((await pageBySlug("set-md"))?.bodyFormat).toBe("markdown");
  });

  test("an invalid document body via set is a field error and nothing is written", async () => {
    const error = await stack.http.writeErr(
      "managed-pages:write:set",
      { slug: "set-bad", lang: "en", title: "Set", body: SCRIPT_BODY, bodyFormat: "document" },
      adminA,
    );
    expectErrorIncludes(error, BODY_REJECTED_I18N_KEY);
    expectErrorIncludes(error, '"path":"body"');
    expect(await pageBySlug("set-bad")).toBeNull();
  });
});

describe("managed-pages :: public render of a stored document that fails the sanitizer", () => {
  test("serves an empty body instead of the raw HTML", async () => {
    // seedPage writes through the executor and skips the write-time check, like
    // a row that predates the validation.
    await seedPage(stack.db, {
      tenantId: TENANT_A,
      slug: "doc-stored-bad",
      lang: "en",
      title: "Stored bad",
      body: SCRIPT_BODY,
      bodyFormat: "document",
      published: true,
    });
    const { status, html } = await publicHtml("doc-stored-bad");
    expect(status).toBe(200);
    expect(html).toContain("Stored bad");
    expect(html).not.toContain("alert(1)");
  });
});

describe("managed-pages :: pages written before bodyFormat existed", () => {
  // The same entity without the field: its create event carries no bodyFormat,
  // exactly like an event stored before the column was introduced.
  const legacyFields = Object.fromEntries(
    Object.entries(pageEntity.fields).filter(([name]) => name !== "bodyFormat"),
  );
  const legacyExecutor = createEventStoreExecutor(
    pagesTable,
    { ...pageEntity, fields: legacyFields },
    { entityName: "page" },
  );

  test("the old event reads as markdown, also after a projection rebuild", async () => {
    const created = await legacyExecutor.create(
      {
        slug: "legacy",
        lang: "en",
        title: "Legacy",
        body: "old **page**",
        description: null,
        ogImage: null,
        published: true,
        tenantId: TENANT_A,
      },
      createSystemUser(TENANT_A),
      createTenantDb({
        db: stack.db,
        tenantId: TENANT_A,
        mode: "system",
        reason: "replay test writes a pre-bodyFormat event into an explicit tenant",
      }),
    );
    expect(created.isSuccess).toBe(true);

    const row = await pageBySlug("legacy");
    if (row === null) throw new Error("legacy page missing");
    const events = await selectMany<{ payload: unknown }>(stack.db, eventsTable, {
      aggregateId: row.id,
    });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0]?.payload)).not.toContain("bodyFormat");

    expect((await publicHtml("legacy")).html).toContain("<strong>page</strong>");

    await rebuildProjection("managed-pages:projection:page-entity", {
      db: stack.db,
      registry: stack.registry,
    });

    const afterRebuild = await publicHtml("legacy");
    expect(afterRebuild.status).toBe(200);
    expect(afterRebuild.html).toContain("<strong>page</strong>");
    const bySlug = await stack.http.queryOk<{ bodyFormat: string }>(
      "managed-pages:query:by-slug",
      { slug: "legacy", lang: "en" },
      adminA,
    );
    expect(bySlug.bodyFormat).toBe("markdown");
  });
});
