// by-tenant / by-slug / set take a `kind` so one content tree can exist per
// r.contentCollection(). Both queries are reachable anonymously (public legal
// pages need that), so the interesting assertions here are the negative ones:
// no kind other than text-block may leave through the anonymous path.

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

describe("kind gating :: anonymous", () => {
  test("anonymous may list text-blocks", async () => {
    const result = await stack.http.queryOk<{ blocks: readonly { slug: string }[] }>(
      TemplateResolverQueries.byTenant,
      {},
      createAnonymousUser(tenantAdmin.tenantId),
    );
    expect(result.blocks.map((b) => b.slug)).toContain("welcome");
  });

  test("anonymous may NOT list mail templates", async () => {
    const error = await stack.http.queryErr(
      TemplateResolverQueries.byTenant,
      { kind: "mail-html" },
      createAnonymousUser(tenantAdmin.tenantId),
    );
    expect(error.code).toBe("access_denied");
  });

  test("anonymous may NOT read a mail template by slug", async () => {
    const error = await stack.http.queryErr(
      TemplateResolverQueries.bySlug,
      { slug: "welcome", locale: "de", kind: "mail-html" },
      createAnonymousUser(tenantAdmin.tenantId),
    );
    expect(error.code).toBe("access_denied");
  });

  test("a logged-in non-admin may NOT read a mail template either", async () => {
    const error = await stack.http.queryErr(
      TemplateResolverQueries.bySlug,
      { slug: "welcome", locale: "de", kind: "mail-html" },
      normalUser,
    );
    expect(error.code).toBe("access_denied");
  });
});

describe("kind gating :: admins", () => {
  test("by-slug returns the row of the requested kind, not the text-block", async () => {
    const mail = await stack.http.queryOk<{ title: string; content: string }>(
      TemplateResolverQueries.bySlug,
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

  test("by-tenant lists only the requested kind", async () => {
    const mails = await stack.http.queryOk<{ blocks: readonly { title: string }[] }>(
      TemplateResolverQueries.byTenant,
      { kind: "mail-html" },
      tenantAdmin,
    );
    expect(mails.blocks.map((b) => b.title)).toEqual(["Willkommen (Mail)"]);
  });

  test("SystemAdmin passes the gate as well", async () => {
    const result = await stack.http.queryOk<{ blocks: readonly unknown[] }>(
      TemplateResolverQueries.byTenant,
      { kind: "mail-html", tenantIdOverride: tenantAdmin.tenantId },
      systemAdmin,
    );
    expect(result.blocks).toHaveLength(1);
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
      TemplateResolverQueries.bySlug,
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
