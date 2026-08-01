import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type DbConnection, fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
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
    // SystemAdmin ist global, hat KEIN implicit TenantAdmin auf seiner
    // membership. Das Set-Handler-ACL muss SystemAdmin explizit erlauben
    // sonst kann niemand Plattform-Texte (z.B. Impressum) setzen.
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
    // Use-case: Plattform-App's Edit-UI lädt SystemAdmin der NICHT
    // member auf SYSTEM_TENANT ist + lässt ihn dort schreiben.
    // Ohne override würde der text auf systemAdmin.tenantId landen
    // statt SYSTEM_TENANT — legal-pages-routes lesen ihn dann nie.
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

    // Beweis: text landed auf TARGET-tenant, nicht auf systemAdmin's
    // eigenem tenant. Read mit denselben override returnt den block.
    const read = await stack.http.queryOk<Record<string, unknown>>(
      TemplateResolverQueries.bySlug,
      { slug: "override-target", locale: "de", tenantIdOverride: targetTenant },
      systemAdmin,
    );
    expect(read).toMatchObject({ slug: "override-target", title: "Override-Test" });
  });

  test("SystemAdmin can UPDATE with tenantIdOverride (regression: stream-lookup must use override-tenantId, not user.tenantId)", async () => {
    // Regression-Guard für 2026-05-04: bei tenantIdOverride MUSS auch der
    // user-context für den event-store-executor remapped werden — sonst
    // landet append() auf user.tenantId aber getStreamVersion (auf
    // update) sucht ebenfalls auf user.tenantId, findet aber NUR den
    // stream auf override-tenantId aus dem ersten write → version_conflict
    // obwohl die projection-row da ist. Test der NUR create+override
    // hatte den Bug nicht gefangen weil append=create ohne stream-lookup.
    const targetTenant = createTestUser({ id: 77 }).tenantId;

    // Schritt 1: create mit override.
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

    // Schritt 2: UPDATE mit override (selbe slug+lang+target). Vor dem
    // Fix: version_conflict. Nach dem Fix: clean update.
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

    // Beweis: read returnt den UPDATED content auf TARGET-tenant.
    const read = await stack.http.queryOk<Record<string, unknown>>(
      TemplateResolverQueries.bySlug,
      { slug: "update-target", locale: "de", tenantIdOverride: targetTenant },
      systemAdmin,
    );
    expect(read).toMatchObject({ slug: "update-target", title: "v2", content: "updated" });
  });

  test("TenantAdmin's tenantIdOverride attempt → 403 access_denied", async () => {
    // Defense-in-Depth: override ist SystemAdmin-only. TenantAdmin
    // darf NICHT auf andere tenants schreiben — sonst könnte ein
    // Tenant-Admin von Tenant-A einfach Tenant-B's Impressum überschreiben.
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
    // Sinnvoller Use-Case: Tenant-Admin legt einen leeren Block als
    // Stub an (z.B. während Onboarding) und befüllt ihn später.
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
    // Dokumentiertes Verhalten: text-content speichert Markdown 1:1.
    // Konsumenten (z.B. legal-pages mit `marked`) müssen entscheiden ob
    // sie sanitizen — siehe legal-pages/README.md XSS-Sektion.
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
    // Roundtrip: Body bleibt exakt was reingeschrieben wurde
    expect(fetched!["content"]).toBe(xssPayload);
  });

  test("concurrent set auf gleichen (tenantId, slug, lang) — mindestens einer succeed", async () => {
    // Race-Test: Zwei TenantAdmins (oder selber Admin von zwei Tabs)
    // setzen gleichzeitig. fetchOne+update ist nicht atomar — wenn
    // beide das selbe `existing` finden und beide updaten wollen,
    // greift Optimistic-Locking via version-check im Executor.
    // Erwartung: einer succeed, einer kann version_conflict werfen
    // (oder beide succeed wenn sequenziell genug). Mindestens einer
    // muss durchlaufen, sonst ist der Race-Pfad kaputt.
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

    // Egal welcher gewinnt — die Row ist nach beiden Aufrufen konsistent
    // mit einem der beiden Werte (kein partial state).
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
    expect(events.map((e) => e.type)).toEqual([
      "template-resource.created",
      "template-resource.updated",
    ]);
  });

  // Drift-Documentation: seedTextBlock geht direkt durch den Executor
  // OHNE slugSchema-Validation, set.write läuft DURCH die Validation.
  // Folge: seedTextBlock akzeptiert Slugs mit ":" oder "/" (legal-pages
  // Plattform-Seeds nutzen das für "page:index:hero.title" etc.), aber
  // ein User-Edit derselben Block über set.write würde mit
  // validation_error fail (regex `^[a-z0-9][a-z0-9-]*$`). Drift ist
  // **bewusst** in V.1.3 — seedTextBlock ist system-trusted (boot-fixture,
  // kein User-Input). V.1.4 plant ein echtes `folder`-Field statt
  // `:`-Separator-im-Slug, dann fällt die Drift weg.
  //
  // Dieser Test pinnt den Status quo: Editor-Form via set.write rejected
  // ":"-Slugs auch wenn seedTextBlock sie angelegt hat. Plus-Test
  // verhindert dass jemand silent seedTextBlock-Validation hinzufügt
  // ohne app-side seed-Slugs (z.B. legal-pages-Plattform-Seeds) zu
  // konvertieren.
  test("seedTextBlock + set.write drift: `:`-slugs sind seed-only, set.write rejected sie", async () => {
    // Seed mit `:`-Slug funktioniert (legal-pages-Pattern)
    const seeded = await seedTextBlock(db, {
      tenantId: tenantAdmin.tenantId,
      slug: "page:hero",
      locale: "de",
      title: "Seeded",
      content: "from-seed",
    });
    expect(seeded.id).toBeDefined();

    // Set.write auf demselben Slug → validation_error (kebab-only regex)
    const error = await stack.http.writeErr(
      TemplateResolverHandlers.set,
      { slug: "page:hero", locale: "de", title: "User-edit", content: "from-write" },
      tenantAdmin,
    );
    expectErrorIncludes(error, "validation_error");
  });

  test("seedTextBlock + set.write parity: kebab-only Slugs durchlaufen beide Pfade", async () => {
    // Inverse-Test: für kebab-only Slugs (`page-hero`) klappen beide
    // Pfade. App-Builder die Edit-Form-fähige Seeds wollen, müssen
    // kebab-only verwenden (siehe publicstatus/bin/seed-demo.ts).
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
