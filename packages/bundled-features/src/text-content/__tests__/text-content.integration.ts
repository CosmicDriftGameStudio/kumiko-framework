import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEntityTable,
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-framework/testing";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { TextContentHandlers, TextContentQueries } from "../constants";
import { createTextContentFeature } from "../feature";
import { seedTextBlock } from "../seeding";
import { textBlockEntity } from "../table";

let stack: TestStack;
let db: DbConnection;

const systemAdmin = TestUsers.systemAdmin;
const tenantAdmin = createTestUser({ id: 2, roles: ["TenantAdmin"] });
const normalUser = createTestUser({ id: 3 });

const feature = createTextContentFeature();

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  db = stack.db;
  await createEntityTable(db, textBlockEntity);
  await createEventsTable(db);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("text-content :: write", () => {
  test("TenantAdmin can create a text block", async () => {
    const result = await stack.http.writeOk<Record<string, unknown>>(
      TextContentHandlers.set,
      {
        slug: "imprint",
        lang: "de",
        title: "Impressum",
        body: "## Angaben gemäß § 5 TMG\n\nMarc Frost",
      },
      tenantAdmin,
    );
    expect(result).toMatchObject({ slug: "imprint", lang: "de", isNew: true });
  });

  test("set is idempotent — second call updates existing block", async () => {
    await stack.http.writeOk(
      TextContentHandlers.set,
      { slug: "privacy", lang: "de", title: "Datenschutz v1", body: "alt" },
      tenantAdmin,
    );
    const result = await stack.http.writeOk<Record<string, unknown>>(
      TextContentHandlers.set,
      { slug: "privacy", lang: "de", title: "Datenschutz v2", body: "neu" },
      tenantAdmin,
    );
    expect(result).toMatchObject({ slug: "privacy", isNew: false });

    const fetched = await stack.http.queryOk<Record<string, unknown>>(
      TextContentQueries.bySlug,
      { slug: "privacy", lang: "de" },
      tenantAdmin,
    );
    expect(fetched).toMatchObject({ title: "Datenschutz v2", body: "neu" });
  });

  test("SystemAdmin can create text blocks for SYSTEM_TENANT (without TenantAdmin role)", async () => {
    // SystemAdmin ist global, hat KEIN implicit TenantAdmin auf seiner
    // membership. Das Set-Handler-ACL muss SystemAdmin explizit erlauben
    // sonst kann niemand Plattform-Texte (z.B. Impressum) setzen.
    const result = await stack.http.writeOk<Record<string, unknown>>(
      TextContentHandlers.set,
      {
        slug: "system-imprint-write",
        lang: "de",
        title: "System-Impressum",
        body: "## Plattform\n\nMarc",
      },
      systemAdmin,
    );
    expect(result).toMatchObject({ slug: "system-imprint-write", isNew: true });
  });

  test("normal User cannot create text blocks (access denied)", async () => {
    const error = await stack.http.writeErr(
      TextContentHandlers.set,
      { slug: "about", lang: "de", title: "Über", body: null },
      normalUser,
    );
    expectErrorIncludes(error, "access_denied");
  });

  test("invalid slug rejected by schema validation", async () => {
    const error = await stack.http.writeErr(
      TextContentHandlers.set,
      { slug: "Invalid Slug!", lang: "de", title: "x", body: null },
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
      TextContentHandlers.set,
      {
        slug: "override-target",
        lang: "de",
        title: "Override-Test",
        body: "via tenantIdOverride",
        tenantIdOverride: targetTenant,
      },
      systemAdmin,
    );
    expect(result).toMatchObject({ slug: "override-target", isNew: true });

    // Beweis: text landed auf TARGET-tenant, nicht auf systemAdmin's
    // eigenem tenant. Read mit denselben override returnt den block.
    const read = await stack.http.queryOk<Record<string, unknown>>(
      TextContentQueries.bySlug,
      { slug: "override-target", lang: "de", tenantIdOverride: targetTenant },
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
      TextContentHandlers.set,
      {
        slug: "update-target",
        lang: "de",
        title: "v1",
        body: "first",
        tenantIdOverride: targetTenant,
      },
      systemAdmin,
    );

    // Schritt 2: UPDATE mit override (selbe slug+lang+target). Vor dem
    // Fix: version_conflict. Nach dem Fix: clean update.
    const result = await stack.http.writeOk<Record<string, unknown>>(
      TextContentHandlers.set,
      {
        slug: "update-target",
        lang: "de",
        title: "v2",
        body: "updated",
        tenantIdOverride: targetTenant,
      },
      systemAdmin,
    );
    expect(result).toMatchObject({ slug: "update-target", isNew: false });

    // Beweis: read returnt den UPDATED content auf TARGET-tenant.
    const read = await stack.http.queryOk<Record<string, unknown>>(
      TextContentQueries.bySlug,
      { slug: "update-target", lang: "de", tenantIdOverride: targetTenant },
      systemAdmin,
    );
    expect(read).toMatchObject({ slug: "update-target", title: "v2", body: "updated" });
  });

  test("TenantAdmin's tenantIdOverride attempt → 403 access_denied", async () => {
    // Defense-in-Depth: override ist SystemAdmin-only. TenantAdmin
    // darf NICHT auf andere tenants schreiben — sonst könnte ein
    // Tenant-Admin von Tenant-A einfach Tenant-B's Impressum überschreiben.
    const otherTenant = createTestUser({ id: 88 }).tenantId;
    const error = await stack.http.writeErr(
      TextContentHandlers.set,
      {
        slug: "evil-override",
        lang: "de",
        title: "evil",
        body: null,
        tenantIdOverride: otherTenant,
      },
      tenantAdmin,
    );
    expectErrorIncludes(error, "access_denied");
  });

  test("invalid lang rejected by schema validation", async () => {
    const error = await stack.http.writeErr(
      TextContentHandlers.set,
      { slug: "ok", lang: "DEUTSCH", title: "x", body: null },
      tenantAdmin,
    );
    expectErrorIncludes(error, "validation_error");
  });
});

describe("text-content :: query (openToAll)", () => {
  test("by-slug returns existing block for matching tenant/lang", async () => {
    await seedTextBlock(db, {
      tenantId: tenantAdmin.tenantId,
      slug: "about",
      lang: "de",
      title: "Über uns",
      body: "Wir sind ein Team.",
    });
    const result = await stack.http.queryOk<Record<string, unknown>>(
      TextContentQueries.bySlug,
      { slug: "about", lang: "de" },
      tenantAdmin,
    );
    expect(result).toMatchObject({
      slug: "about",
      lang: "de",
      title: "Über uns",
      body: "Wir sind ein Team.",
    });
  });

  test("by-slug returns null for missing block", async () => {
    const result = await stack.http.queryOk<Record<string, unknown> | null>(
      TextContentQueries.bySlug,
      { slug: "does-not-exist", lang: "de" },
      tenantAdmin,
    );
    expect(result).toBeFalsy();
  });

  test("by-slug isolates by tenant — other tenant's block invisible", async () => {
    const otherTenant = createTestUser({
      id: 99,
      tenantId: "11111111-1111-4111-8111-111111111111",
    });
    await seedTextBlock(db, {
      tenantId: tenantAdmin.tenantId,
      slug: "tenant-only",
      lang: "de",
      title: "Tenant-A only",
    });
    const result = await stack.http.queryOk<Record<string, unknown> | null>(
      TextContentQueries.bySlug,
      { slug: "tenant-only", lang: "de" },
      otherTenant,
    );
    // null oder undefined je nach pipeline-shape — beides bedeutet "nicht gefunden"
    expect(result).toBeFalsy();
  });

  test("by-slug works for SystemAdmin scoped to system tenant", async () => {
    await seedTextBlock(db, {
      tenantId: systemAdmin.tenantId,
      slug: "system-imprint",
      lang: "de",
      title: "System-Impressum",
      body: "Plattform-Betreiber",
    });
    const result = await stack.http.queryOk<Record<string, unknown>>(
      TextContentQueries.bySlug,
      { slug: "system-imprint", lang: "de" },
      systemAdmin,
    );
    expect(result).toMatchObject({ title: "System-Impressum" });
  });
});

describe("text-content :: edge-cases", () => {
  test("body=null roundtrip — set + query liefert null body zurück", async () => {
    // Sinnvoller Use-Case: Tenant-Admin legt einen leeren Block als
    // Stub an (z.B. während Onboarding) und befüllt ihn später.
    await stack.http.writeOk<Record<string, unknown>>(
      TextContentHandlers.set,
      { slug: "stub-page", lang: "de", title: "Wird noch gefüllt", body: null },
      tenantAdmin,
    );
    const fetched = await stack.http.queryOk<Record<string, unknown>>(
      TextContentQueries.bySlug,
      { slug: "stub-page", lang: "de" },
      tenantAdmin,
    );
    expect(fetched).toMatchObject({ title: "Wird noch gefüllt", body: null });
  });

  test("body=null kann via update auf string gesetzt werden", async () => {
    await stack.http.writeOk(
      TextContentHandlers.set,
      { slug: "later-filled", lang: "de", title: "Stub", body: null },
      tenantAdmin,
    );
    await stack.http.writeOk(
      TextContentHandlers.set,
      { slug: "later-filled", lang: "de", title: "Stub", body: "Inhalt" },
      tenantAdmin,
    );
    const fetched = await stack.http.queryOk<Record<string, unknown>>(
      TextContentQueries.bySlug,
      { slug: "later-filled", lang: "de" },
      tenantAdmin,
    );
    expect(fetched!["body"]).toBe("Inhalt");
  });

  test("body knapp unter max-length (100k Zeichen) wird akzeptiert", async () => {
    const justBelowMax = "a".repeat(100_000);
    const result = await stack.http.writeOk<Record<string, unknown>>(
      TextContentHandlers.set,
      { slug: "max-length-ok", lang: "de", title: "Max", body: justBelowMax },
      tenantAdmin,
    );
    expect(result).toMatchObject({ slug: "max-length-ok", isNew: true });
  });

  test("body über max-length (100k+1 Zeichen) → validation_error", async () => {
    const overLimit = "a".repeat(100_001);
    const error = await stack.http.writeErr(
      TextContentHandlers.set,
      { slug: "max-length-fail", lang: "de", title: "Over", body: overLimit },
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
      TextContentHandlers.set,
      { slug: "xss-test", lang: "de", title: "XSS", body: xssPayload },
      tenantAdmin,
    );
    const fetched = await stack.http.queryOk<Record<string, unknown>>(
      TextContentQueries.bySlug,
      { slug: "xss-test", lang: "de" },
      tenantAdmin,
    );
    // Roundtrip: Body bleibt exakt was reingeschrieben wurde
    expect(fetched!["body"]).toBe(xssPayload);
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
      TextContentHandlers.set,
      { slug: "race-test", lang: "de", title: "Initial", body: "v1" },
      tenantAdmin,
    );

    const results = await Promise.allSettled([
      stack.http.writeOk(
        TextContentHandlers.set,
        { slug: "race-test", lang: "de", title: "A", body: "from-a" },
        tenantAdmin,
      ),
      stack.http.writeOk(
        TextContentHandlers.set,
        { slug: "race-test", lang: "de", title: "B", body: "from-b" },
        tenantAdmin,
      ),
    ]);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    expect(succeeded).toBeGreaterThanOrEqual(1);

    // Egal welcher gewinnt — die Row ist nach beiden Aufrufen konsistent
    // mit einem der beiden Werte (kein partial state).
    const fetched = await stack.http.queryOk<Record<string, unknown>>(
      TextContentQueries.bySlug,
      { slug: "race-test", lang: "de" },
      tenantAdmin,
    );
    const finalBody = fetched!["body"];
    expect(["from-a", "from-b", "v1"]).toContain(finalBody);
  });
});

describe("text-content :: seedTextBlock", () => {
  test("seedTextBlock is idempotent", async () => {
    const a = await seedTextBlock(db, {
      tenantId: tenantAdmin.tenantId,
      slug: "seed-test",
      lang: "de",
      title: "v1",
      body: "alt",
    });
    const b = await seedTextBlock(db, {
      tenantId: tenantAdmin.tenantId,
      slug: "seed-test",
      lang: "de",
      title: "v2",
      body: "neu",
    });
    expect(a.id).toBe(b.id);
  });
});
