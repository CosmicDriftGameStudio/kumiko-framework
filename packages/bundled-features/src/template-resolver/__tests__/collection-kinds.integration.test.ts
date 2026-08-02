// Collections read through their own admin-only handler pair
// (collection-list / collection-item) while by-tenant / by-slug stay public
// and pinned to text-block. The interesting assertions are the negative ones:
// nothing but a text-block leaves through the anonymous path, and the public
// handlers have no kind parameter that could change that.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type DbConnection, fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { createAnonymousUser } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTemplateResolverFeature } from "../feature";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../qualified-names";
import { seedTextBlock } from "../seeding";
import { type TemplateResourceRow, templateResourceEntity, templateResourcesTable } from "../table";

let stack: TestStack;
let db: DbConnection;

const systemAdmin = TestUsers.systemAdmin;
const tenantAdmin = createTestUser({ id: 2, roles: ["TenantAdmin"] });
const normalUser = createTestUser({ id: 3 });

const feature = createTemplateResolverFeature();

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  db = stack.db;
  await unsafeCreateEntityTable(db, templateResourceEntity);
  await createEventsTable(db);

  // One text-block and one mail template on the same tenant, same slug — the
  // pair that proves the kind actually selects the row instead of being
  // decoration on the payload.
  await seedTextBlock(db, {
    tenantId: tenantAdmin.tenantId,
    slug: "welcome",
    locale: "de",
    title: "Willkommen (Text-Block)",
    content: "Statischer Text.",
  });
  await stack.http.writeOk(
    TemplateResolverHandlers.set,
    {
      slug: "welcome",
      kind: "mail-html",
      locale: "de",
      title: "Willkommen (Mail)",
      content: "<p>Hallo {{name}}</p>",
      contentFormat: "html",
    },
    tenantAdmin,
  );
});

afterAll(async () => {
  await stack.cleanup();
});

describe("public handlers :: kind is not reachable", () => {
  test("anonymous may list text-blocks", async () => {
    const result = await stack.http.queryOk<{ blocks: readonly { slug: string }[] }>(
      TemplateResolverQueries.byTenant,
      {},
      createAnonymousUser(tenantAdmin.tenantId),
    );
    expect(result.blocks.map((b) => b.slug)).toContain("welcome");
  });

  test("a kind in the by-tenant payload changes nothing — text-blocks either way", async () => {
    // The public handler has no kind field. Passing one must not widen what
    // comes back; zod strips it and the query stays pinned to text-block.
    const result = await stack.http.queryOk<{ blocks: readonly { title: string }[] }>(
      TemplateResolverQueries.byTenant,
      { kind: "mail-html" },
      createAnonymousUser(tenantAdmin.tenantId),
    );
    expect(result.blocks.map((b) => b.title)).toEqual(["Willkommen (Text-Block)"]);
  });

  test("a kind in the by-slug payload still returns the text-block", async () => {
    const result = await stack.http.queryOk<{ title: string }>(
      TemplateResolverQueries.bySlug,
      { slug: "welcome", locale: "de", kind: "mail-html" },
      createAnonymousUser(tenantAdmin.tenantId),
    );
    expect(result.title).toBe("Willkommen (Text-Block)");
  });
});

describe("collection handlers :: access", () => {
  test("anonymous may not list a collection", async () => {
    const error = await stack.http.queryErr(
      TemplateResolverQueries.collectionList,
      { kind: "mail-html" },
      createAnonymousUser(tenantAdmin.tenantId),
    );
    expect(error.code).toBe("access_denied");
  });

  test("a logged-in non-admin may not either", async () => {
    const error = await stack.http.queryErr(
      TemplateResolverQueries.collectionList,
      { kind: "mail-html" },
      normalUser,
    );
    expect(error.code).toBe("access_denied");
  });

  test("anonymous may not read a single collection item", async () => {
    const error = await stack.http.queryErr(
      TemplateResolverQueries.collectionItem,
      { slug: "welcome", locale: "de", kind: "mail-html" },
      createAnonymousUser(tenantAdmin.tenantId),
    );
    expect(error.code).toBe("access_denied");
  });

  test("collection-list requires a kind — no implicit default", async () => {
    const error = await stack.http.queryErr(
      TemplateResolverQueries.collectionList,
      {},
      tenantAdmin,
    );
    expect(error.code).toBeDefined();
  });
});

describe("collection handlers :: admins", () => {
  test("collection-item returns the requested kind, not the text-block of the same slug", async () => {
    const mail = await stack.http.queryOk<{ title: string; content: string }>(
      TemplateResolverQueries.collectionItem,
      { slug: "welcome", locale: "de", kind: "mail-html" },
      tenantAdmin,
    );
    expect(mail.title).toBe("Willkommen (Mail)");

    const block = await stack.http.queryOk<{ title: string }>(
      TemplateResolverQueries.bySlug,
      { slug: "welcome", locale: "de" },
      tenantAdmin,
    );
    expect(block.title).toBe("Willkommen (Text-Block)");
  });

  test("collection-list lists only the requested kind", async () => {
    const mails = await stack.http.queryOk<{ blocks: readonly { title: string }[] }>(
      TemplateResolverQueries.collectionList,
      { kind: "mail-html" },
      tenantAdmin,
    );
    expect(mails.blocks.map((b) => b.title)).toEqual(["Willkommen (Mail)"]);
  });

  test("SystemAdmin reaches another tenant's collection via tenantIdOverride", async () => {
    const result = await stack.http.queryOk<{ blocks: readonly unknown[] }>(
      TemplateResolverQueries.collectionList,
      { kind: "mail-html", tenantIdOverride: tenantAdmin.tenantId },
      systemAdmin,
    );
    expect(result.blocks).toHaveLength(1);
  });

  test("TenantAdmin may not use tenantIdOverride", async () => {
    const error = await stack.http.queryErr(
      TemplateResolverQueries.collectionList,
      { kind: "mail-html", tenantIdOverride: systemAdmin.tenantId },
      tenantAdmin,
    );
    expect(error.code).toBe("access_denied");
  });
});

describe("set :: kind round-trip", () => {
  test("editing through a collection updates that kind's row and leaves the text-block alone", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.set,
      {
        slug: "welcome",
        kind: "mail-html",
        locale: "de",
        title: "Willkommen (Mail, v2)",
        content: "<p>Servus {{name}}</p>",
        contentFormat: "html",
      },
      tenantAdmin,
    );

    const mail = await stack.http.queryOk<{ title: string }>(
      TemplateResolverQueries.collectionItem,
      { slug: "welcome", locale: "de", kind: "mail-html" },
      tenantAdmin,
    );
    expect(mail.title).toBe("Willkommen (Mail, v2)");

    const block = await stack.http.queryOk<{ title: string }>(
      TemplateResolverQueries.bySlug,
      { slug: "welcome", locale: "de" },
      tenantAdmin,
    );
    expect(block.title).toBe("Willkommen (Text-Block)");
  });

  test("creating through a collection publishes immediately — no draft stage", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.set,
      {
        slug: "invoice",
        kind: "mail-html",
        locale: "de",
        title: "Rechnung",
        content: "<p>Rechnung</p>",
        contentFormat: "html",
      },
      tenantAdmin,
    );

    const row = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
      tenantId: tenantAdmin.tenantId,
      slug: "invoice",
      kind: "mail-html",
      locale: "de",
    });
    // The tree editor is the no-draft route; upsertTenant + publish is the
    // one that stages. Pinned because the split is easy to "fix" by accident.
    expect(row?.status).toBe("active");
    expect(row?.variableSchema).toBe("{}");
  });
});
