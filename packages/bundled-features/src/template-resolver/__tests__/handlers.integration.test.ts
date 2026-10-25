import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { expectErrorIncludes } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createTemplateResolverFeature } from "../feature.ts";
import { templateResourceEntity } from "../table.ts";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../web/qualified-names.ts";
import { tenantEditableTemplates } from "./tenant-editable-fixture.ts";

const TENANT_EDITABLE = tenantEditableTemplates(
  ["mail", "ai-prompt"],
  [
    "test-slug",
    "system-new",
    "system-idem",
    "tenant-blocked",
    "user-blocked",
    "tenant-own",
    "tenant-default-draft",
    "tenant-explicit-active",
    "system-override",
    "denied-system-override",
    "denied-override",
    "user-denied",
    "publish-test",
    "isolation-publish",
    "archive-test",
    "isolation-archive",
    "find-own",
    "find-isolation",
    "find-system",
    "list-system-1",
    "list-tenant-1",
    "list-system-2",
    "list-tenant-2",
    "sysown-system",
    "sysown-own",
    "sysown-tenant-a",
    "syscross-system",
    "syscross-own",
    "syscross-tenant-b",
    "list-iso",
    "filter-draft",
    "filter-active",
  ],
);

let stack: TestStack;
let db: DbConnection;

const systemAdmin = TestUsers.systemAdmin;
// Explicit, distinct tenantIds — createTestUser defaults to
// TestUsers.admin.tenantId (all users would otherwise share one tenant).
// Each test user therefore uses a separate tenant to test tenant isolation.
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

const feature = createTemplateResolverFeature({ tenantEditable: TENANT_EDITABLE });

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  db = stack.db;
  await unsafeCreateEntityTable(db, templateResourceEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

const basePayload = {
  slug: "test-slug",
  kind: "ai-prompt" as const,
  locale: "de",
  content: "Hello {{variables.name}}",
  contentFormat: "markdown" as const,
  variableSchema: { name: { type: "string" } },
  linkedResources: {},
};

// The event-store executor has no dedicated audit-trail test because
// `stack.events.postSave` is not populated in the current test-stack setup
// (pipeline-hook wiring differs from the production path). The resolver and
// handler tests provide indirect evidence: if the executor did not write to
// the database, findById/list/resolveTemplate would find nothing. A dedicated
// audit-log test should query the `read_events` table directly.
describe("template-resolver :: upsertSystem", () => {
  test("SystemAdmin can create a system template", async () => {
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
  test("TenantAdmin can create an override for their own tenant", async () => {
    const result = await stack.http.writeOk<Record<string, unknown>>(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "tenant-own" },
      tenantA_Admin,
    );
    expect(result).toMatchObject({ slug: "tenant-own", isNew: true });
  });

  test("default-status is draft, explicit active also works", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "tenant-default-draft" },
      tenantA_Admin,
    );
    const fetched = await stack.http.queryOk<Record<string, unknown>>(
      TemplateResolverQueries.list,
      { kind: "ai-prompt", locale: "de", includeSystem: false },
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
      { kind: "ai-prompt", locale: "de", includeSystem: false },
      tenantA_Admin,
    );
    const found2 = (fetched2 as unknown as Array<{ slug: string; status: string }>).find(
      (r) => r.slug === "tenant-explicit-active",
    );
    expect(found2?.status).toBe("active");
  });

  test("SystemAdmin can write across tenants via tenantIdOverride", async () => {
    const result = await stack.http.writeOk<Record<string, unknown>>(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "system-override", tenantIdOverride: tenantA_Admin.tenantId },
      systemAdmin,
    );
    expect(result).toMatchObject({ slug: "system-override", isNew: true });

    const events = await selectMany<{ tenantId: string; createdBy: string }>(
      stack.db,
      eventsTable,
      { aggregateId: String(result["id"]) },
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.tenantId).toBe(tenantA_Admin.tenantId);
    expect(events[0]?.createdBy).toBe(systemAdmin.id);
  });

  test("SystemAdmin override for SYSTEM_TENANT_ID → access_denied (use upsertSystem)", async () => {
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
  test("publish sets status to active", async () => {
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

  test("publish: TenantA cannot publish TenantB's Template (refused)", async () => {
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
    expectErrorIncludes(err, "access_denied");
  });

  test("publish: non-existent ID → refused like a locked template", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.publish,
      { id: "00000000-0000-4000-8000-000000000999" },
      tenantA_Admin,
    );
    expectErrorIncludes(err, "access_denied");
  });

  test("archive sets status to archived", async () => {
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

  test("archive: tenant isolation (refused for foreign tenant)", async () => {
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
    expectErrorIncludes(err, "access_denied");
  });

  // Cross-tenant publish/archive for SystemAdmin is not implemented: ctx.db is
  // tenant-scoped (createTenantDb in dispatcher). It requires
  // `tenantIdOverride` in the schema, as in upsertTenant.
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

  test("returns null for a foreign tenant", async () => {
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

  test("System Templates are visible to all authenticated users", async () => {
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

  // Cross-tenant findById for SystemAdmin is not implemented for the same
  // reason as publish/archive. ctx.db is tenant-scoped and the findById
  // schema requires tenantIdOverride.
});

describe("template-resolver :: list query", () => {
  test("includeSystem=true shows own + system templates", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      { ...basePayload, slug: "list-system-1", locale: "de", kind: "ai-prompt" },
      systemAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "list-tenant-1", locale: "de", kind: "ai-prompt" },
      tenantA_Admin,
    );
    const result = (await stack.http.queryOk(
      TemplateResolverQueries.list,
      { kind: "ai-prompt", locale: "de", includeSystem: true },
      tenantA_Admin,
    )) as Array<{ slug: string; scope: string }>;
    const slugs = result.map((r) => r.slug);
    expect(slugs).toContain("list-system-1");
    expect(slugs).toContain("list-tenant-1");
  });

  test("includeSystem=false shows only their own tenant", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      { ...basePayload, slug: "list-system-2", locale: "tr", kind: "ai-prompt" },
      systemAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "list-tenant-2", locale: "tr", kind: "ai-prompt" },
      tenantA_Admin,
    );
    const result = (await stack.http.queryOk(
      TemplateResolverQueries.list,
      { kind: "ai-prompt", locale: "tr", includeSystem: false },
      tenantA_Admin,
    )) as Array<{ slug: string; scope: string }>;
    const slugs = result.map((r) => r.slug);
    expect(slugs).toContain("list-tenant-2");
    expect(slugs).not.toContain("list-system-2");
  });

  // The list query intentionally limits SystemAdmin to the [own, SYSTEM]
  // scope through TenantDb; it provides no cross-tenant view of other tenant
  // templates. TestUsers.systemAdmin belongs to testTenantId(1), not the
  // system tenant.
  test("SystemAdmin + includeSystem=false → only their own tenant, neither System nor foreign-tenant Templates", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      { ...basePayload, slug: "sysown-system", locale: "pl", kind: "ai-prompt" },
      systemAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "sysown-own", locale: "pl", kind: "ai-prompt" },
      systemAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "sysown-tenant-a", locale: "pl", kind: "ai-prompt" },
      tenantA_Admin,
    );
    const result = (await stack.http.queryOk(
      TemplateResolverQueries.list,
      { kind: "ai-prompt", locale: "pl", includeSystem: false },
      systemAdmin,
    )) as Array<{ slug: string }>;
    const slugs = result.map((r) => r.slug);
    expect(slugs).toContain("sysown-own");
    expect(slugs).not.toContain("sysown-system");
    expect(slugs).not.toContain("sysown-tenant-a");
  });

  test("SystemAdmin + includeSystem=true → own and System Templates, foreign tenant remains invisible", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      { ...basePayload, slug: "syscross-system", locale: "nl", kind: "ai-prompt" },
      systemAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "syscross-own", locale: "nl", kind: "ai-prompt" },
      systemAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "syscross-tenant-b", locale: "nl", kind: "ai-prompt" },
      tenantB_Admin,
    );
    const result = (await stack.http.queryOk(
      TemplateResolverQueries.list,
      { kind: "ai-prompt", locale: "nl", includeSystem: true },
      systemAdmin,
    )) as Array<{ slug: string }>;
    const slugs = result.map((r) => r.slug);
    expect(slugs).toContain("syscross-system");
    expect(slugs).toContain("syscross-own");
    expect(slugs).not.toContain("syscross-tenant-b");
  });

  test("tenant isolation: TenantA's templates are not visible to TenantB", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "list-iso", locale: "fr", kind: "ai-prompt" },
      tenantA_Admin,
    );
    const result = (await stack.http.queryOk(
      TemplateResolverQueries.list,
      { kind: "ai-prompt", locale: "fr", includeSystem: false },
      tenantB_Admin,
    )) as Array<{ slug: string }>;
    expect(result.map((r) => r.slug)).not.toContain("list-iso");
  });

  test("status-Filter funktioniert", async () => {
    const draft = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      { ...basePayload, slug: "filter-draft", locale: "es", kind: "ai-prompt", status: "draft" },
      tenantA_Admin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      {
        ...basePayload,
        slug: "filter-active",
        locale: "es",
        kind: "ai-prompt",
        status: "active",
      },
      tenantA_Admin,
    );
    const drafts = (await stack.http.queryOk(
      TemplateResolverQueries.list,
      { kind: "ai-prompt", locale: "es", status: "draft", includeSystem: false },
      tenantA_Admin,
    )) as Array<{ slug: string }>;
    expect(drafts.map((r) => r.slug)).toContain("filter-draft");
    expect(drafts.map((r) => r.slug)).not.toContain("filter-active");

    expect(draft.id).toBeTruthy();
  });
});
