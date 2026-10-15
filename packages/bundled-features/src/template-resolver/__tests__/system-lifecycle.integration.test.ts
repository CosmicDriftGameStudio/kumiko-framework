import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  defineFeature,
  type SessionUser,
  templateVariable,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import * as z from "zod";
import { createTemplateResolverApi, TemplateNotFoundError } from "../api.js";
import { createTemplateResolverFeature } from "../feature.js";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../qualified-names.js";
import { templateResourceEntity } from "../table.js";

const MAIL_SLUG = "lifecycle-mailer:notify:hello";
const PLAIN_SLUG = "lifecycle-mailer:notify:plain";

const mailer = defineFeature("lifecycle-mailer", (r) => {
  r.writeHandler({
    name: "create",
    schema: z.object({}),
    access: { roles: ["TenantAdmin"] },
    handler: async () => ({ isSuccess: true as const, data: {} }),
  });
  r.notification("hello", {
    trigger: { on: "create" },
    recipient: () => null,
    data: () => ({}),
    variables: { name: templateVariable.text({ required: true }) },
    template: { de: { body: '<p>Hi <span data-variable="name"></span></p>' } },
    meta: { de: { subject: "Hallo {{name}}", layoutSlug: "fancy" } },
  });
  r.notification("plain", {
    trigger: { on: "create" },
    recipient: () => null,
    data: () => ({}),
    template: { de: { body: "<p>Plain</p>" } },
    meta: { de: { subject: "Plain" } },
  });
});

const systemAdmin = TestUsers.systemAdmin;
const tenantAdmin = createTestUser({ id: 2, roles: ["TenantAdmin"], tenantId: testTenantId(10) });
const otherTenantAdmin = createTestUser({
  id: 3,
  roles: ["TenantAdmin"],
  tenantId: testTenantId(20),
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createTemplateResolverFeature(), mailer] });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

function notificationPayload(slug: string, extra: Record<string, unknown> = {}) {
  return {
    slug,
    kind: "notification" as const,
    locale: "de",
    content: "Hallo",
    contentFormat: "markdown" as const,
    variableSchema: {},
    linkedResources: {},
    ...extra,
  };
}

function mailPayload(content: string, subject: string) {
  return {
    slug: MAIL_SLUG,
    kind: "mail" as const,
    locale: "de",
    content,
    contentFormat: "html" as const,
    meta: { subject },
    variableSchema: {},
    linkedResources: {},
  };
}

function pdfPayload(slug: string, extra: Record<string, unknown> = {}) {
  return {
    slug,
    kind: "document-pdf" as const,
    locale: "de",
    content: "<p>Rechnung</p>",
    contentFormat: "html" as const,
    variableSchema: {},
    linkedResources: {},
    ...extra,
  };
}

function resolve(
  tenantIndex: number,
  slug: string,
  kind: "notification" | "mail" = "notification",
) {
  return createTemplateResolverApi(stack.db).resolveTemplate({
    tenantId: testTenantId(tenantIndex),
    slug,
    kind,
    locale: "de",
  });
}

type FoundRow = { id: string; status: string; version: number; meta: string | null };

function findById(id: string, user: SessionUser = systemAdmin) {
  return stack.http.queryOk<FoundRow>(TemplateResolverQueries.findById, { id }, user);
}

describe("template-resolver :: PDF meta", () => {
  test("a document-pdf with valid meta is stored and read back", async () => {
    const meta = {
      pageFormat: "Letter",
      margins: { top: 20, left: 15.5 },
      fileName: "Rechnung-{{invoiceNumber}}.pdf",
      metadata: { title: "Rechnung", author: "ACME" },
    };
    const created = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertSystem,
      pdfPayload("invoice-pdf", { meta }),
      systemAdmin,
    );
    const row = await findById(created.id);
    expect(JSON.parse(row.meta ?? "null")).toEqual(meta);
  });

  test("invalid pdf meta is rejected with meta.* issues", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.upsertSystem,
      pdfPayload("invoice-pdf-bad", {
        meta: { pageFormat: "A5", fileName: "../x.pdf", margins: { top: 101 }, extra: 1 },
      }),
      systemAdmin,
    );
    expect(err.httpStatus).toBe(400);
    const fields = (err.details as { fields: Array<{ path: string; code: string }> }).fields;
    const paths = fields.map((field) => field.path);
    expect(paths).toContain("meta.pageFormat");
    expect(paths).toContain("meta.fileName");
    expect(paths).toContain("meta.margins.top");
    expect(fields.every((field) => field.code === "invalid_meta")).toBe(true);
  });
});

describe("template-resolver :: own-tenant status handlers", () => {
  test("a TenantAdmin cannot archive a system row through archive", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertSystem,
      notificationPayload("guard-system-row"),
      systemAdmin,
    );
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.archive,
      { id: created.id },
      tenantAdmin,
    );
    expect(err.code).toBe("not_found");
    expect((await findById(created.id)).status).toBe("active");
  });
});

describe("template-resolver :: archive-system / publish-system", () => {
  const slug = "lifecycle-system-row";
  let systemRowId: string;

  beforeAll(async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertSystem,
      notificationPayload(slug),
      systemAdmin,
    );
    systemRowId = created.id;
  });

  test("a TenantAdmin is denied on both handlers", async () => {
    for (const handler of [
      TemplateResolverHandlers.archiveSystem,
      TemplateResolverHandlers.publishSystem,
    ]) {
      const err = await stack.http.writeErr(handler, { id: systemRowId }, tenantAdmin);
      expect(err.httpStatus).toBe(403);
    }
  });

  test("archive-system makes the resolver fall through, publish-system serves it again", async () => {
    expect((await resolve(10, slug)).id).toBe(systemRowId);

    await stack.http.writeOk(
      TemplateResolverHandlers.archiveSystem,
      { id: systemRowId },
      systemAdmin,
    );
    expect((await findById(systemRowId)).status).toBe("archived");
    await expect(resolve(10, slug)).rejects.toBeInstanceOf(TemplateNotFoundError);

    await stack.http.writeOk(
      TemplateResolverHandlers.publishSystem,
      { id: systemRowId },
      systemAdmin,
    );
    expect((await resolve(10, slug)).id).toBe(systemRowId);
  });

  test("a tenant row id is NotFound for the system handlers", async () => {
    const draft = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      notificationPayload("lifecycle-tenant-row"),
      tenantAdmin,
    );
    for (const handler of [
      TemplateResolverHandlers.archiveSystem,
      TemplateResolverHandlers.publishSystem,
    ]) {
      const err = await stack.http.writeErr(handler, { id: draft.id }, systemAdmin);
      expect(err.code).toBe("not_found");
    }
    expect((await findById(draft.id, tenantAdmin)).status).toBe("draft");
  });

  test("publish-system applies the mail gate", async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertSystem,
      mailPayload('<p>Hi <span data-variable="name"></span></p>', "Hallo {{name}}"),
      systemAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.archiveSystem,
      { id: created.id },
      systemAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.publishSystem,
      { id: created.id },
      systemAdmin,
    );
    expect((await findById(created.id)).status).toBe("active");
  });
});

describe("template-resolver :: usage", () => {
  type Usage = {
    usedBy: Array<{
      qualifiedName: string;
      feature: string;
      notification: string;
      trigger: string;
      role: string;
    }>;
  };

  test("a mail slug lists the notification it belongs to", async () => {
    const usage = await stack.http.queryOk<Usage>(
      TemplateResolverQueries.usage,
      { slug: MAIL_SLUG, kind: "mail" },
      tenantAdmin,
    );
    expect(usage.usedBy).toEqual([
      {
        qualifiedName: MAIL_SLUG,
        feature: "lifecycle-mailer",
        notification: "hello",
        trigger: "lifecycle-mailer:write:create",
        role: "template",
      },
    ]);
  });

  test("the default layout is used by notifications without a layoutSlug, a named one by its notification", async () => {
    const byDefault = await stack.http.queryOk<Usage>(
      TemplateResolverQueries.usage,
      { slug: "default", kind: "mail-layout" },
      tenantAdmin,
    );
    expect(byDefault.usedBy.map((entry) => [entry.qualifiedName, entry.role])).toEqual([
      [PLAIN_SLUG, "layout"],
    ]);
    const fancy = await stack.http.queryOk<Usage>(
      TemplateResolverQueries.usage,
      { slug: "fancy", kind: "mail-layout" },
      tenantAdmin,
    );
    expect(fancy.usedBy.map((entry) => entry.qualifiedName)).toEqual([MAIL_SLUG]);
  });

  test("other kinds have no usage", async () => {
    const usage = await stack.http.queryOk<Usage>(
      TemplateResolverQueries.usage,
      { slug: MAIL_SLUG, kind: "document-pdf" },
      tenantAdmin,
    );
    expect(usage.usedBy).toEqual([]);
  });
});

describe("template-resolver :: tenant-overrides without the tenant feature", () => {
  test("counts overrides per tenant and reports no total", async () => {
    const slug = "overrides-no-tenant-feature";
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      notificationPayload(slug),
      systemAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      notificationPayload(slug, { status: "active" }),
      tenantAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      notificationPayload(slug),
      otherTenantAdmin,
    );
    const counts = await stack.http.queryOk(
      TemplateResolverQueries.tenantOverrides,
      { slug, kind: "notification" },
      systemAdmin,
    );
    expect(counts).toEqual({ activeOverrides: 1, draftOverrides: 1, totalTenants: null });
  });
});

describe("template-resolver :: diff-to-system", () => {
  type Diff = {
    tenant: { templateId: string; templateVersion: number; contentFormat: string };
    system: { templateId: string; templateVersion: number; contentFormat: string };
    identical: boolean;
    blocks: Array<{ change: string; content: string }>;
    meta: Array<{ key: string; tenant: unknown; system: unknown }>;
  };
  const systemBody = '<p>Hi <span data-variable="name"></span></p><p>Alt</p>';
  let systemRowId: string;

  beforeAll(async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertSystem,
      mailPayload(systemBody, "Hallo {{name}}"),
      systemAdmin,
    );
    systemRowId = created.id;
  });

  test("reports the changed paragraph and the changed subject", async () => {
    const draft = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      mailPayload('<p>Hi <span data-variable="name"></span></p><p>Neu</p>', "Servus {{name}}"),
      tenantAdmin,
    );
    const diff = await stack.http.queryOk<Diff>(
      TemplateResolverQueries.diffToSystem,
      { id: draft.id },
      tenantAdmin,
    );
    expect(diff.identical).toBe(false);
    expect(diff.tenant.contentFormat).toBe("html");
    expect(diff.system.contentFormat).toBe("html");
    expect(diff.tenant.templateId).toBe(draft.id);
    expect(diff.system.templateId).toBe(systemRowId);
    expect(diff.blocks.map((block) => block.change)).toEqual(["same", "removed", "added"]);
    expect(diff.blocks[1]?.content).toContain("Alt");
    expect(diff.blocks[2]?.content).toContain("Neu");
    expect(diff.meta).toEqual([
      { key: "subject", tenant: "Servus {{name}}", system: "Hallo {{name}}" },
    ]);
  });

  test("an identical override is reported as identical", async () => {
    const draft = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      mailPayload(systemBody, "Hallo {{name}}"),
      otherTenantAdmin,
    );
    const diff = await stack.http.queryOk<Diff>(
      TemplateResolverQueries.diffToSystem,
      { id: draft.id },
      otherTenantAdmin,
    );
    expect(diff.identical).toBe(true);
    expect(diff.meta).toEqual([]);
  });

  test("a system row id and a foreign tenant row id are NotFound", async () => {
    const own = await stack.http.queryErr(
      TemplateResolverQueries.diffToSystem,
      { id: systemRowId },
      tenantAdmin,
    );
    expect(own.code).toBe("not_found");
    const foreignDraft = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      notificationPayload("diff-foreign"),
      otherTenantAdmin,
    );
    const foreign = await stack.http.queryErr(
      TemplateResolverQueries.diffToSystem,
      { id: foreignDraft.id },
      tenantAdmin,
    );
    expect(foreign.code).toBe("not_found");
  });
});

describe("template-resolver :: reset-to-system", () => {
  const slug = "reset-target";
  let systemRowId: string;

  beforeAll(async () => {
    const created = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertSystem,
      notificationPayload(slug),
      systemAdmin,
    );
    systemRowId = created.id;
  });

  test("archives the override so the resolver serves the system row again", async () => {
    const override = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      notificationPayload(slug, { content: "Eigener Text", status: "active" }),
      tenantAdmin,
    );
    expect((await resolve(10, slug)).id).toBe(override.id);

    const result = await stack.http.writeOk<{
      id: string;
      status: string;
      systemTemplateId: string;
    }>(TemplateResolverHandlers.resetToSystem, { id: override.id }, tenantAdmin);
    expect(result).toEqual({ id: override.id, status: "archived", systemTemplateId: systemRowId });
    expect((await resolve(10, slug)).id).toBe(systemRowId);

    const again = await stack.http.writeOk<{ status: string }>(
      TemplateResolverHandlers.resetToSystem,
      { id: override.id },
      tenantAdmin,
    );
    expect(again.status).toBe("archived");
  });

  test("the system row id is NotFound", async () => {
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resetToSystem,
      { id: systemRowId },
      tenantAdmin,
    );
    expect(err.code).toBe("not_found");
  });

  test("an override without an active system counterpart is a validation error", async () => {
    const orphan = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      notificationPayload("reset-orphan", { status: "active" }),
      tenantAdmin,
    );
    const err = await stack.http.writeErr(
      TemplateResolverHandlers.resetToSystem,
      { id: orphan.id },
      tenantAdmin,
    );
    expect(err.httpStatus).toBe(400);
    expect((err.details as { fields: Array<{ code: string }> }).fields[0]?.code).toBe(
      "no_system_template",
    );
  });
});
