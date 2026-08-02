import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createTenantDb,
  type DbConnection,
  fetchOne,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-framework/testing";
import { TEXT_BLOCK_KIND } from "../constants";
import { createTemplateResolverFeature } from "../feature";
import { executor } from "../handlers/shared";
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
});

afterAll(async () => {
  await stack.cleanup();
});

describe("text-blocks :: write", () => {
  test("TenantAdmin can create a text block", async () => {
    const result = await stack.http.writeOk<Record<string, unknown>>(
      TemplateResolverHandlers.set,
      {
        slug: "imprint",
        locale: "de",
        title: "Impressum",
        content: "## Angaben gemäß § 5 TMG\n\nMarc Frost",
      },
      tenantAdmin,
    );
    expect(result).toMatchObject({ slug: "imprint", locale: "de", isNew: true });
  });

  test("set is idempotent — second call updates existing block", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.set,
      { slug: "privacy", locale: "de", title: "Datenschutz v1", content: "alt" },
      tenantAdmin,
    );
    const result = await stack.http.writeOk<Record<string, unknown>>(
      TemplateResolverHandlers.set,
      { slug: "privacy", locale: "de", title: "Datenschutz v2", content: "neu" },
      tenantAdmin,
    );
    expect(result).toMatchObject({ slug: "privacy", isNew: false });

    const fetched = await stack.http.queryOk<Record<string, unknown>>(
      TemplateResolverQueries.bySlug,
      { slug: "privacy", locale: "de" },
      tenantAdmin,
    );
    expect(fetched).toMatchObject({ title: "Datenschutz v2", content: "neu" });
  });

  test("SystemAdmin can create text blocks for SYSTEM_TENANT (without TenantAdmin role)", async () => {
    // SystemAdmin is global and has NO implicit TenantAdmin on its
    // membership. The set-handler ACL must explicitly allow SystemAdmin,
    // otherwise no one could set platform texts (e.g. imprint).
    const result = await stack.http.writeOk<Record<string, unknown>>(
      TemplateResolverHandlers.set,
      {
        slug: "system-imprint-write",
        locale: "de",
        title: "System-Impressum",
        content: "## Plattform\n\nMarc",
      },
      systemAdmin,
    );
    expect(result).toMatchObject({ slug: "system-imprint-write", isNew: true });
  });

  test("normal User cannot create text blocks (access denied)", async () => {
    const error = await stack.http.writeErr(
      TemplateResolverHandlers.set,
      { slug: "about", locale: "de", title: "Über", content: null },
      normalUser,
    );
    expectErrorIncludes(error, "access_denied");
  });

  test("invalid slug rejected by schema validation", async () => {
    const error = await stack.http.writeErr(
      TemplateResolverHandlers.set,
      { slug: "Invalid Slug!", locale: "de", title: "x", content: null },
      tenantAdmin,
    );
    expectErrorIncludes(error, "validation_error");
  });

  test("SystemAdmin can write with tenantIdOverride to a different tenant (legal-pages use-case)", async () => {
    // Use-case: a platform app's edit UI loads a SystemAdmin who is NOT
    // a member of SYSTEM_TENANT and lets them write there.
    // Without override, the text would land on systemAdmin.tenantId
    // instead of SYSTEM_TENANT — legal-pages routes would never read it.
    const targetTenant = createTestUser({ id: 99 }).tenantId;
    const result = await stack.http.writeOk<Record<string, unknown>>(
      TemplateResolverHandlers.set,
      {
        slug: "override-target",
        locale: "de",
        title: "Override-Test",
        content: "via tenantIdOverride",
        tenantIdOverride: targetTenant,
      },
      systemAdmin,
    );
    expect(result).toMatchObject({ slug: "override-target", isNew: true });

    // Proof: text landed on the TARGET tenant, not on systemAdmin's
    // own tenant. Reading with the same override returns the block.
    const read = await stack.http.queryOk<Record<string, unknown>>(
      TemplateResolverQueries.bySlug,
      { slug: "override-target", locale: "de", tenantIdOverride: targetTenant },
      systemAdmin,
    );
    expect(read).toMatchObject({ slug: "override-target", title: "Override-Test" });
  });

  test("SystemAdmin can UPDATE with tenantIdOverride (regression: stream-lookup must use override-tenantId, not user.tenantId)", async () => {
    // Regression guard for 2026-05-04: with tenantIdOverride, the
    // user-context for the event-store executor MUST also be remapped —
    // otherwise append() lands on user.tenantId but getStreamVersion (on
    // update) also looks up user.tenantId, finding only the stream on
    // override-tenantId from the first write → version_conflict even
    // though the projection row is there. A test with only create+override
    // did not catch the bug because append=create has no stream lookup.
    const targetTenant = createTestUser({ id: 77 }).tenantId;

    // Step 1: create with override.
    await stack.http.writeOk<Record<string, unknown>>(
      TemplateResolverHandlers.set,
      {
        slug: "update-target",
        locale: "de",
        title: "v1",
        content: "first",
        tenantIdOverride: targetTenant,
      },
      systemAdmin,
    );

    // Step 2: UPDATE with override (same slug+lang+target). Before the
    // fix: version_conflict. After the fix: clean update.
    const result = await stack.http.writeOk<Record<string, unknown>>(
      TemplateResolverHandlers.set,
      {
        slug: "update-target",
        locale: "de",
        title: "v2",
        content: "updated",
        tenantIdOverride: targetTenant,
      },
      systemAdmin,
    );
    expect(result).toMatchObject({ slug: "update-target", isNew: false });

    // Proof: read returns the UPDATED content on the TARGET tenant.
    const read = await stack.http.queryOk<Record<string, unknown>>(
      TemplateResolverQueries.bySlug,
      { slug: "update-target", locale: "de", tenantIdOverride: targetTenant },
      systemAdmin,
    );
    expect(read).toMatchObject({ slug: "update-target", title: "v2", content: "updated" });
  });

  test("TenantAdmin's tenantIdOverride attempt → 403 access_denied", async () => {
    // Defense-in-depth: override is SystemAdmin-only. TenantAdmin
    // must NOT be able to write to other tenants — otherwise a
    // tenant admin of tenant A could simply overwrite tenant B's imprint.
    const otherTenant = createTestUser({ id: 88 }).tenantId;
    const error = await stack.http.writeErr(
      TemplateResolverHandlers.set,
      {
        slug: "evil-override",
        locale: "de",
        title: "evil",
        content: null,
        tenantIdOverride: otherTenant,
      },
      tenantAdmin,
    );
    expectErrorIncludes(error, "access_denied");
  });

  test("invalid lang rejected by schema validation", async () => {
    const error = await stack.http.writeErr(
      TemplateResolverHandlers.set,
      { slug: "ok", locale: "DEUTSCH", title: "x", content: null },
      tenantAdmin,
    );
    expectErrorIncludes(error, "validation_error");
  });

  test("update only touches the editable columns — variableSchema/status survive a save", async () => {
    // set.write shares the table with the template upserts. If it wrote its
    // whole field set on update, every editor save would reset a row's
    // variableSchema to {} and force status back to active.
    await stack.http.writeOk(
      TemplateResolverHandlers.set,
      { slug: "shared-row", locale: "de", title: "v1", content: "first" },
      tenantAdmin,
    );
    const row = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
      tenantId: tenantAdmin.tenantId,
      slug: "shared-row",
      kind: TEXT_BLOCK_KIND,
      locale: "de",
    });
    await executor.update(
      {
        id: String(row!.id),
        version: row!.version,
        changes: { variableSchema: JSON.stringify({ firstName: "string" }), status: "archived" },
      },
      createSystemUser(tenantAdmin.tenantId),
      createTenantDb(db, tenantAdmin.tenantId, "system"),
    );

    await stack.http.writeOk(
      TemplateResolverHandlers.set,
      { slug: "shared-row", locale: "de", title: "v2", content: "second" },
      tenantAdmin,
    );

    const after = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
      tenantId: tenantAdmin.tenantId,
      slug: "shared-row",
      kind: TEXT_BLOCK_KIND,
      locale: "de",
    });
    expect(after).toMatchObject({
      title: "v2",
      content: "second",
      variableSchema: JSON.stringify({ firstName: "string" }),
      status: "archived",
    });
  });
});

describe("text-blocks :: query (openToAll)", () => {
  test("by-slug returns existing block for matching tenant/lang", async () => {
    await seedTextBlock(db, {
      tenantId: tenantAdmin.tenantId,
      slug: "about",
      locale: "de",
      title: "Über uns",
      content: "Wir sind ein Team.",
    });
    const result = await stack.http.queryOk<Record<string, unknown>>(
      TemplateResolverQueries.bySlug,
      { slug: "about", locale: "de" },
      tenantAdmin,
    );
    expect(result).toMatchObject({
      slug: "about",
      locale: "de",
      title: "Über uns",
      content: "Wir sind ein Team.",
    });
  });

  test("by-slug returns null for missing block", async () => {
    const result = await stack.http.queryOk<Record<string, unknown> | null>(
      TemplateResolverQueries.bySlug,
      { slug: "does-not-exist", locale: "de" },
      tenantAdmin,
    );
    expect(result).toBeFalsy();
  });

  test("by-slug isolates by tenant — other tenant's block invisible", async () => {
    const otherTenant = createTestUser({
      id: 99,
      tenantId: "11111111-1111-4111-8111-111111111111",
      roles: ["TenantAdmin"],
    });
    await seedTextBlock(db, {
      tenantId: tenantAdmin.tenantId,
      slug: "tenant-only",
      locale: "de",
      title: "Tenant-A only",
    });
    const result = await stack.http.queryOk<Record<string, unknown> | null>(
      TemplateResolverQueries.bySlug,
      { slug: "tenant-only", locale: "de" },
      otherTenant,
    );
    expect(result).toBeNull();
  });

  test("by-slug works for SystemAdmin scoped to system tenant", async () => {
    await seedTextBlock(db, {
      tenantId: systemAdmin.tenantId,
      slug: "system-imprint",
      locale: "de",
      title: "System-Impressum",
      content: "Plattform-Betreiber",
    });
    const result = await stack.http.queryOk<Record<string, unknown>>(
      TemplateResolverQueries.bySlug,
      { slug: "system-imprint", locale: "de" },
      systemAdmin,
    );
    expect(result).toMatchObject({ title: "System-Impressum" });
  });
});

describe("text-blocks :: edge-cases", () => {
  test("body=null roundtrip — set + query liefert null body zurück", async () => {
    // Realistic use-case: a tenant admin creates an empty block as a
    // stub (e.g. during onboarding) and fills it in later.
    await stack.http.writeOk<Record<string, unknown>>(
      TemplateResolverHandlers.set,
      { slug: "stub-page", locale: "de", title: "Wird noch gefüllt", content: null },
      tenantAdmin,
    );
    const fetched = await stack.http.queryOk<Record<string, unknown>>(
      TemplateResolverQueries.bySlug,
      { slug: "stub-page", locale: "de" },
      tenantAdmin,
    );
    expect(fetched).toMatchObject({ title: "Wird noch gefüllt", content: null });
  });

  test("body=null kann via update auf string gesetzt werden", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.set,
      { slug: "later-filled", locale: "de", title: "Stub", content: null },
      tenantAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.set,
      { slug: "later-filled", locale: "de", title: "Stub", content: "Inhalt" },
      tenantAdmin,
    );
    const fetched = await stack.http.queryOk<Record<string, unknown>>(
      TemplateResolverQueries.bySlug,
      { slug: "later-filled", locale: "de" },
      tenantAdmin,
    );
    expect(fetched!["content"]).toBe("Inhalt");
  });

  test("body knapp unter max-length (200k Zeichen) wird akzeptiert", async () => {
    const justBelowMax = "a".repeat(200_000);
    const result = await stack.http.writeOk<Record<string, unknown>>(
      TemplateResolverHandlers.set,
      { slug: "max-length-ok", locale: "de", title: "Max", content: justBelowMax },
      tenantAdmin,
    );
    expect(result).toMatchObject({ slug: "max-length-ok", isNew: true });
  });

  test("body über max-length (200k+1 Zeichen) → validation_error", async () => {
    const overLimit = "a".repeat(200_001);
    const error = await stack.http.writeErr(
      TemplateResolverHandlers.set,
      { slug: "max-length-fail", locale: "de", title: "Over", content: overLimit },
      tenantAdmin,
    );
    expectErrorIncludes(error, "validation_error");
  });

  test("body mit XSS-Payload wird unverändert gespeichert (Markdown-Renderer ist verantwortlich für Escaping)", async () => {
    // Documented behavior: text-content stores markdown 1:1.
    // Consumers (e.g. legal-pages with `marked`) must decide whether
    // to sanitize — see legal-pages/README.md XSS section.
    const xssPayload = "## Title\n\n<script>alert('xss')</script>\n\nText.";
    await stack.http.writeOk(
      TemplateResolverHandlers.set,
      { slug: "xss-test", locale: "de", title: "XSS", content: xssPayload },
      tenantAdmin,
    );
    const fetched = await stack.http.queryOk<Record<string, unknown>>(
      TemplateResolverQueries.bySlug,
      { slug: "xss-test", locale: "de" },
      tenantAdmin,
    );
    // Roundtrip: body stays exactly what was written in
    expect(fetched!["content"]).toBe(xssPayload);
  });

  test("concurrent set auf gleichen (tenantId, slug, lang) — mindestens einer succeed", async () => {
    // Race test: two tenant admins (or the same admin from two tabs)
    // write concurrently. fetchOne+update is not atomic — if both find
    // the same `existing` and both try to update, optimistic locking
    // via the executor's version check kicks in.
    // Expectation: one succeeds, one may throw version_conflict
    // (or both succeed if sequential enough). At least one
    // must go through, otherwise the race path is broken.
    await stack.http.writeOk(
      TemplateResolverHandlers.set,
      { slug: "race-test", locale: "de", title: "Initial", content: "v1" },
      tenantAdmin,
    );

    const results = await Promise.allSettled([
      stack.http.writeOk(
        TemplateResolverHandlers.set,
        { slug: "race-test", locale: "de", title: "A", content: "from-a" },
        tenantAdmin,
      ),
      stack.http.writeOk(
        TemplateResolverHandlers.set,
        { slug: "race-test", locale: "de", title: "B", content: "from-b" },
        tenantAdmin,
      ),
    ]);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBeGreaterThanOrEqual(1);

    // Whichever wins — the row is consistent after both calls
    // with one of the two values (no partial state).
    const fetched = await stack.http.queryOk<Record<string, unknown>>(
      TemplateResolverQueries.bySlug,
      { slug: "race-test", locale: "de" },
      tenantAdmin,
    );
    const finalBody = fetched!["content"] as string;
    expect(["from-a", "from-b", "v1"]).toContain(finalBody);
  });
});

describe("text-blocks :: seedTextBlock", () => {
  test('ifExists="update" overwrites existing row (same aggregate id)', async () => {
    const a = await seedTextBlock(db, {
      tenantId: tenantAdmin.tenantId,
      slug: "seed-test",
      locale: "de",
      title: "v1",
      content: "alt",
    });
    const b = await seedTextBlock(db, {
      tenantId: tenantAdmin.tenantId,
      slug: "seed-test",
      locale: "de",
      title: "v2",
      content: "neu",
      ifExists: "update",
    });
    expect(a.id).toBe(b.id);
  });

  test('default ifExists="skip" does not overwrite on re-boot', async () => {
    const base = {
      tenantId: tenantAdmin.tenantId,
      slug: "seed-skip",
      locale: "de",
    };
    await seedTextBlock(db, {
      ...base,
      title: "Initial",
      content: "from seed",
    });
    await seedTextBlock(db, {
      ...base,
      title: "User edit",
      content: "from admin",
      ifExists: "update",
    });
    await seedTextBlock(db, {
      ...base,
      title: "Seed again",
      content: "would overwrite",
    });

    const row = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
      ...base,
      kind: TEXT_BLOCK_KIND,
    });
    expect(row).toMatchObject({ title: "User edit", content: "from admin", version: 2 });

    const events = await selectMany(db, eventsTable, {
      aggregateId: String(row!.id),
    });
    expect(events).toHaveLength(2);
    // Sorted: selectMany has no ORDER BY and both events share a timestamp.
    expect(events.map((e) => e.type).sort()).toEqual([
      "template-resource.created",
      "template-resource.updated",
    ]);
  });

  // Drift documentation: seedTextBlock goes directly through the executor
  // WITHOUT slugSchema validation, set.write goes THROUGH the validation.
  // Consequence: seedTextBlock accepts slugs with ":" or "/" (legal-pages
  // platform seeds use this for "page:index:hero.title" etc.), but
  // a user edit of the same block via set.write would fail with
  // validation_error (regex `^[a-z0-9][a-z0-9-]*$`). The drift is
  // **deliberate** in V.1.3 — seedTextBlock is system-trusted (boot fixture,
  // no user input). V.1.4 plans a real `folder` field instead of a
  // `:` separator in the slug, then the drift goes away.
  //
  // This test pins the status quo: the editor form via set.write rejects
  // ":" slugs even if seedTextBlock created them. This test guards
  // against someone silently adding seedTextBlock validation
  // without converting app-side seed slugs (e.g. legal-pages platform
  // seeds).
  test("seedTextBlock + set.write drift: `:`-slugs sind seed-only, set.write rejected sie", async () => {
    // Seed with `:` slug works (legal-pages pattern)
    const seeded = await seedTextBlock(db, {
      tenantId: tenantAdmin.tenantId,
      slug: "page:hero",
      locale: "de",
      title: "Seeded",
      content: "from-seed",
    });
    expect(seeded.id).toBeDefined();

    // set.write on the same slug → validation_error (kebab-only regex)
    const error = await stack.http.writeErr(
      TemplateResolverHandlers.set,
      { slug: "page:hero", locale: "de", title: "User-edit", content: "from-write" },
      tenantAdmin,
    );
    expectErrorIncludes(error, "validation_error");
  });

  test("seedTextBlock + set.write parity: kebab-only Slugs durchlaufen beide Pfade", async () => {
    // Inverse test: for kebab-only slugs (`page-hero`) both paths
    // work. App builders who want edit-form-capable seeds must
    // use kebab-only (see publicstatus/bin/seed-demo.ts).
    await seedTextBlock(db, {
      tenantId: tenantAdmin.tenantId,
      slug: "page-hero",
      locale: "de",
      title: "Seeded",
      content: "from-seed",
    });
    const result = await stack.http.writeOk<{ slug: string; locale: string }>(
      TemplateResolverHandlers.set,
      { slug: "page-hero", locale: "de", title: "User-edit", content: "from-write" },
      tenantAdmin,
    );
    expect(result.slug).toBe("page-hero");
  });
});
