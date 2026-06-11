import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-framework/testing";
import { createTemplateResolverFeature } from "../feature";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../qualified-names";
import { templateResourceEntity } from "../table";

let stack: TestStack;
let db: DbConnection;

const systemAdmin = TestUsers.systemAdmin;
// Explizite, distinct tenantIds — createTestUser default-falls auf
// TestUsers.admin.tenantId (alle User im selben Tenant). Wir testen
// Tenant-Isolation, deshalb pro Test-User eigener Tenant.
const tenantA_Admin = createTestUser({
  id: 2,
  roles: ["TenantAdmin"],
  tenantId: testTenantId(10),
});
const tenantB_Admin = createTestUser({
  id: 3,
  roles: ["TenantAdmin"],
  tenantId: testTenantId(20),
});
const normalUser = createTestUser({ id: 4, tenantId: testTenantId(10) });

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

const basePayload = {
  slug: "test-slug",
  kind: "mail-html" as const,
  locale: "de",
  content: "Hello {{variables.name}}",
  contentFormat: "markdown" as const,
  variableSchema: { name: { type: "string" } },
  linkedResources: {},
};

// Audit-Trail via event-store-executor: kein dedizierter Test, weil
// `stack.events.postSave` im aktuellen Test-Stack-Setup nicht aktiv
// populated wird (Pipeline-Hooks-Wiring unterschiedlich zum Prod-Path).
// Indirekter Beweis: alle Resolver/Handler-Tests funktionieren — würde
// der executor nicht in die DB schreiben, würden findById/list/
// resolveTemplate alles nichts finden. Wenn echtes Audit-Log-Test
// gebraucht wird: direkt `read_events`-Tabelle abfragen.
describe("template-resolver :: upsertSystem", () => {
  test("SystemAdmin kann System-Template anlegen", async () => {
    const result = await stack.http.writeOk<Record<string, unknown>>(
      TemplateResolverHandlers.upsertSystem,
      { ...basePayload, slug: "system-new" },
      systemAdmin,
    );
    expect(result).toMatchObject({ slug: "system-new", isNew: true });
  });

  test("idempotent — zweiter Call updated existing System-Template", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      { ...basePayload, slug: "system-idem", content: "v1" },
      systemAdmin,
    );
    const result = await stack.http.writeOk<Record<string, unknown>>(
      TemplateResolverHandlers.upsertSystem,
      { ...basePayload, slug: "system-idem", content: "v2" },
      systemAdmin,
    );
    expect(result).toMatchObject({ slug: "system-idem", isNew: false });
  });

  test("TenantAdmin denied (access_denied)", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.upsertSystem,
      { ...basePayload, slug: "tenant-blocked" },
      tenantA_Admin,
    );
    expectErrorIncludes(err, "access_denied");
  });

  test("normal User denied", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.upsertSystem,
      { ...basePayload, slug: "user-blocked" },
      normalUser,
    );
    expectErrorIncludes(err, "access_denied");
  });

  test("invalid slug rejected", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.upsertSystem,
      { ...basePayload, slug: "Invalid Slug!" },
      systemAdmin,
    );
    expectErrorIncludes(err, "validation_error");
  });
});

describe("template-resolver :: upsertTenant", () => {
  test("TenantAdmin kann Override für eigenen Tenant anlegen", async () => {
    const result = await stack.http.writeOk<Record<string, unknown>>(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "tenant-own" },
      tenantA_Admin,
    );
    expect(result).toMatchObject({ slug: "tenant-own", isNew: true });
  });

  test("default-status ist draft, explizites active geht auch", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "tenant-default-draft" },
      tenantA_Admin,
    );
    const fetched = await stack.http.queryOk<Record<string, unknown>>(
      TemplateResolverQueries.list,
      { kind: "mail-html", locale: "de", includeSystem: false },
      tenantA_Admin,
    );
    const found = (fetched as unknown as Array<{ slug: string; status: string }>).find(
      (r) => r.slug === "tenant-default-draft",
    );
    expect(found?.status).toBe("draft");

    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "tenant-explicit-active", status: "active" },
      tenantA_Admin,
    );
    const fetched2 = await stack.http.queryOk<Record<string, unknown>>(
      TemplateResolverQueries.list,
      { kind: "mail-html", locale: "de", includeSystem: false },
      tenantA_Admin,
    );
    const found2 = (fetched2 as unknown as Array<{ slug: string; status: string }>).find(
      (r) => r.slug === "tenant-explicit-active",
    );
    expect(found2?.status).toBe("active");
  });

  test("SystemAdmin kann via tenantIdOverride cross-tenant schreiben", async () => {
    const result = await stack.http.writeOk<Record<string, unknown>>(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "system-override", tenantIdOverride: tenantA_Admin.tenantId },
      systemAdmin,
    );
    expect(result).toMatchObject({ slug: "system-override", isNew: true });
  });

  test("SystemAdmin-Override auf SYSTEM_TENANT_ID → access_denied (use upsertSystem)", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "denied-system-override", tenantIdOverride: SYSTEM_TENANT_ID },
      systemAdmin,
    );
    expectErrorIncludes(err, "access_denied");
  });

  test("TenantAdmin-Override-Versuch → access_denied", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "denied-override", tenantIdOverride: tenantB_Admin.tenantId },
      tenantA_Admin,
    );
    expectErrorIncludes(err, "access_denied");
  });

  test("normal User denied", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "user-denied" },
      normalUser,
    );
    expectErrorIncludes(err, "access_denied");
  });
});

describe("template-resolver :: publish + archive", () => {
  test("publish setzt status auf active", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "publish-test", status: "draft" },
      tenantA_Admin,
    );
    const published = await stack.http.writeOk<Record<string, unknown>>(
      TemplateResolverHandlers.publish,
      { id: created.id },
      tenantA_Admin,
    );
    expect(published).toMatchObject({ status: "active" });
  });

  test("publish: TenantA kann TenantB's Template nicht publishen (NotFound)", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "isolation-publish" },
      tenantA_Admin,
    );
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.publish,
      { id: created.id },
      tenantB_Admin,
    );
    expectErrorIncludes(err, "not_found");
  });

  test("publish: nicht-existierender ID → NotFound", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.publish,
      { id: "00000000-0000-4000-8000-000000000999" },
      tenantA_Admin,
    );
    expectErrorIncludes(err, "not_found");
  });

  test("archive setzt status auf archived", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "archive-test", status: "active" },
      tenantA_Admin,
    );
    const archived = await stack.http.writeOk<Record<string, unknown>>(
      TemplateResolverHandlers.archive,
      { id: created.id },
      tenantA_Admin,
    );
    expect(archived).toMatchObject({ status: "archived" });
  });

  test("archive: tenant-isolation (NotFound bei fremdem Tenant)", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "isolation-archive" },
      tenantA_Admin,
    );
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.archive,
      { id: created.id },
      tenantB_Admin,
    );
    expectErrorIncludes(err, "not_found");
  });

  // SystemAdmin-Cross-Tenant-Publish/Archive nicht implementiert: ctx.db ist
  // tenant-scoped (createTenantDb in dispatcher). Braucht `tenantIdOverride`
  // im Schema wie upsertTenant. M2-Erweiterung wenn Admin-UI das fordert.
});

describe("template-resolver :: findById query", () => {
  test("findet eigenes Template", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "find-own" },
      tenantA_Admin,
    );
    const result = await stack.http.queryOk<Record<string, unknown>>(
      TemplateResolverQueries.findById,
      { id: created.id },
      tenantA_Admin,
    );
    expect(result).toMatchObject({ slug: "find-own", scope: "tenant" });
  });

  test("returnt null bei fremdem Tenant", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "find-isolation" },
      tenantA_Admin,
    );
    const result = await stack.http.queryOk(
      TemplateResolverQueries.findById,
      { id: created.id },
      tenantB_Admin,
    );
    expect(result).toBeNull();
  });

  test("System-Templates sind für alle authentifizierten User sichtbar", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertSystem,
      { ...basePayload, slug: "find-system" },
      systemAdmin,
    );
    const result = await stack.http.queryOk<Record<string, unknown>>(
      TemplateResolverQueries.findById,
      { id: created.id },
      tenantA_Admin,
    );
    expect(result).toMatchObject({ slug: "find-system", scope: "system" });
    expect((result as { tenantId: string }).tenantId).toBe(SYSTEM_TENANT_ID);
  });

  // SystemAdmin-Cross-Tenant-FindById nicht implementiert — gleicher Grund
  // wie publish/archive. ctx.db tenant-scoped, braucht tenantIdOverride im
  // findById-Schema. M2-Erweiterung.
});

describe("template-resolver :: list query", () => {
  test("includeSystem=true zeigt eigene + system", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      { ...basePayload, slug: "list-system-1", locale: "de", kind: "mail-html" },
      systemAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "list-tenant-1", locale: "de", kind: "mail-html" },
      tenantA_Admin,
    );
    const result = (await stack.http.queryOk(
      TemplateResolverQueries.list,
      { kind: "mail-html", locale: "de", includeSystem: true },
      tenantA_Admin,
    )) as Array<{ slug: string; scope: string }>;
    const slugs = result.map((r) => r.slug);
    expect(slugs).toContain("list-system-1");
    expect(slugs).toContain("list-tenant-1");
  });

  test("includeSystem=false zeigt nur eigenen Tenant", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      { ...basePayload, slug: "list-system-2", locale: "tr", kind: "notification" },
      systemAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "list-tenant-2", locale: "tr", kind: "notification" },
      tenantA_Admin,
    );
    const result = (await stack.http.queryOk(
      TemplateResolverQueries.list,
      { kind: "notification", locale: "tr", includeSystem: false },
      tenantA_Admin,
    )) as Array<{ slug: string; scope: string }>;
    const slugs = result.map((r) => r.slug);
    expect(slugs).toContain("list-tenant-2");
    expect(slugs).not.toContain("list-system-2");
  });

  // Regressions-Pin 230/2 — SystemAdmin-Zweige der list-Query. Empirisch
  // (und gewollt): auch SystemAdmin sieht über die TenantDb nur den
  // [own, SYSTEM]-Scope — es gibt KEINE Cross-Tenant-Sicht auf fremde
  // Tenant-Templates. TestUsers.systemAdmin lebt in testTenantId(1),
  // NICHT im System-Tenant.
  test("SystemAdmin + includeSystem=false → nur eigener Tenant, weder System- noch Fremd-Templates", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      { ...basePayload, slug: "sysown-system", locale: "pl", kind: "mail-html" },
      systemAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "sysown-own", locale: "pl", kind: "mail-html" },
      systemAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "sysown-tenant-a", locale: "pl", kind: "mail-html" },
      tenantA_Admin,
    );
    const result = (await stack.http.queryOk(
      TemplateResolverQueries.list,
      { kind: "mail-html", locale: "pl", includeSystem: false },
      systemAdmin,
    )) as Array<{ slug: string }>;
    const slugs = result.map((r) => r.slug);
    expect(slugs).toContain("sysown-own");
    expect(slugs).not.toContain("sysown-system");
    expect(slugs).not.toContain("sysown-tenant-a");
  });

  test("SystemAdmin + includeSystem=true → eigene + System-Templates, Fremd-Tenant bleibt unsichtbar", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      { ...basePayload, slug: "syscross-system", locale: "nl", kind: "mail-html" },
      systemAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "syscross-own", locale: "nl", kind: "mail-html" },
      systemAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "syscross-tenant-b", locale: "nl", kind: "mail-html" },
      tenantB_Admin,
    );
    const result = (await stack.http.queryOk(
      TemplateResolverQueries.list,
      { kind: "mail-html", locale: "nl", includeSystem: true },
      systemAdmin,
    )) as Array<{ slug: string }>;
    const slugs = result.map((r) => r.slug);
    expect(slugs).toContain("syscross-system");
    expect(slugs).toContain("syscross-own");
    expect(slugs).not.toContain("syscross-tenant-b");
  });

  test("tenant-isolation: TenantA's templates nicht für TenantB", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "list-iso", locale: "fr", kind: "notification" },
      tenantA_Admin,
    );
    const result = (await stack.http.queryOk(
      TemplateResolverQueries.list,
      { kind: "notification", locale: "fr", includeSystem: false },
      tenantB_Admin,
    )) as Array<{ slug: string }>;
    expect(result.map((r) => r.slug)).not.toContain("list-iso");
  });

  test("status-Filter funktioniert", async () => {
    const draft = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "filter-draft", locale: "es", kind: "notification", status: "draft" },
      tenantA_Admin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      {
        ...basePayload,
        slug: "filter-active",
        locale: "es",
        kind: "notification",
        status: "active",
      },
      tenantA_Admin,
    );
    const drafts = (await stack.http.queryOk(
      TemplateResolverQueries.list,
      { kind: "notification", locale: "es", status: "draft", includeSystem: false },
      tenantA_Admin,
    )) as Array<{ slug: string }>;
    expect(drafts.map((r) => r.slug)).toContain("filter-draft");
    expect(drafts.map((r) => r.slug)).not.toContain("filter-active");

    // Sicherstellen dass draft existiert
    expect(draft.id).toBeTruthy();
  });
});
