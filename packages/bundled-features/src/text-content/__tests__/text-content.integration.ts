import type { DbConnection } from "@kumiko/framework/db";
import { createEventsTable } from "@kumiko/framework/event-store";
import {
  createEntityTable,
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
} from "@kumiko/framework/stack";
import { expectErrorIncludes } from "@kumiko/framework/testing";
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
