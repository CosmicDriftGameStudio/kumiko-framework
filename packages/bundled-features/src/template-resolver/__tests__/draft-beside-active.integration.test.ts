import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  createEventStoreExecutor,
  createTenantDb,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createRegistry,
  defineFeature,
  templateVariable,
} from "@cosmicdrift/kumiko-framework/engine";
import { rebuildProjection } from "@cosmicdrift/kumiko-framework/pipeline";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { isPlainObject, propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import * as z from "zod";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.ts";
import { createTemplateResolverApi } from "../api.ts";
import { createTemplateResolverFeature } from "../feature.ts";
import type { LayoutSourceResponse, OverviewResponse } from "../index.ts";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../qualified-names.ts";
import { seedSystemTemplate, seedTextBlock } from "../seeding.ts";
import {
  type TemplateResourceRow,
  templateResourceEntity,
  templateResourcesTable,
} from "../table.ts";
import { tenantEditableTemplates } from "./tenant-editable-fixture.ts";

const PLAIN_NAMES = [
  "lifecycle",
  "gate-free",
  "copy",
  "counted",
  "snap",
  "legacy",
  "system",
  "sysdraft",
];
const slugOf = (name: string) => `dd-mailer:notify:${name}`;

const TENANT_EDITABLE = tenantEditableTemplates(
  ["mail", "mail-layout", "document-pdf", "ai-prompt", "text-block"],
  [
    ...PLAIN_NAMES.map(slugOf),
    slugOf("gated"),
    "dd-layout",
    "dd-mailer:doc",
    "dd-system-layout",
    "dd-seeded",
    "dd-seeded-block",
  ],
);

const mailer = defineFeature("dd-mailer", (r) => {
  r.writeHandler({
    name: "create",
    schema: z.object({}),
    access: { roles: ["TenantAdmin"] },
    handler: async () => ({ isSuccess: true as const, data: {} }),
  });
  r.notification("gated", {
    trigger: { on: "create" },
    recipient: () => null,
    data: () => ({}),
    variables: { name: templateVariable.text({ required: true }) },
  });
  for (const name of PLAIN_NAMES) {
    r.notification(name, {
      trigger: { on: "create" },
      recipient: () => null,
      data: () => ({}),
    });
  }
});

const tenantId = testTenantId(10);
const admin = createTestUser({ id: 2, roles: ["TenantAdmin"], tenantId });
const systemAdmin = TestUsers.systemAdmin;

const LAYOUT_ACTIVE =
  "<div data-header><p>Aktiver Kopf</p></div><div data-content></div><div data-signature><p>Gruss</p></div><div data-footer><p>Impressum</p></div>";
const LAYOUT_DRAFT =
  "<div data-header><p>Entwurf Kopf</p></div><div data-content></div><div data-signature><p>Gruss</p></div><div data-footer><p>Impressum</p></div>";

type WorkingVersion = {
  id: string;
  version: number;
  status: string;
  content: string | null;
  meta: string | null;
  active: { version: number; since: string } | null;
};

let stack: TestStack;

function mailPayload(name: string, body: string, extra: Record<string, unknown> = {}) {
  return {
    slug: slugOf(name),
    kind: "mail" as const,
    locale: "de",
    content: `<p>${body}</p>`,
    contentFormat: "html" as const,
    variableSchema: {},
    meta: { subject: body },
    ...extra,
  };
}

async function saveMail(
  name: string,
  body: string,
  extra: Record<string, unknown> = {},
  user = admin,
): Promise<string> {
  const written = await stack.http.writeOk<{ id: string }>(
    TemplateResolverHandlers.upsertTenant,
    mailPayload(name, body, extra),
    user,
  );
  return written.id;
}

function findWorking(id: string, user = admin): Promise<WorkingVersion> {
  return stack.http.queryOk<WorkingVersion>(TemplateResolverQueries.findById, { id }, user);
}

async function servedContent(name: string, locale = "de"): Promise<string> {
  const resolved = await createTemplateResolverApi(stack.db, stack.registry).resolveTemplate({
    tenantId,
    slug: slugOf(name),
    kind: "mail",
    locale,
  });
  return resolved.content;
}

function validationCodes(err: { details?: unknown }): string[] {
  const fields = propertyOf(err.details, "fields");
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((field) => {
    const code = isPlainObject(field) ? field["code"] : undefined;
    return typeof code === "string" ? [code] : [];
  });
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createTemplateResolverFeature({ tenantEditable: TENANT_EDITABLE }),
      createRendererFoundationFeature(),
      createRendererMailHtmlFeature(),
      mailer,
    ],
  });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("template-resolver :: draft beside the active version", () => {
  test("a draft over an active override leaves the served version alone", async () => {
    const id = await saveMail("lifecycle", "Aktiv", { status: "active" });
    const before = await findWorking(id);
    expect(before).toMatchObject({ status: "active", active: { version: before.version } });

    await saveMail("lifecycle", "Entwurf");

    expect(await servedContent("lifecycle")).toContain("Aktiv");
    const preview = await stack.http.queryOk<{ html: string }>(
      TemplateResolverQueries.preview,
      { slug: slugOf("lifecycle"), kind: "mail", locale: "de" },
      admin,
    );
    expect(preview.html).toContain("Aktiv");
    expect(preview.html).not.toContain("Entwurf");
    const working = await findWorking(id);
    expect(working.status).toBe("draft");
    expect(working.content).toContain("Entwurf");
    expect(working.version).toBe(before.version + 1);
    expect(working.active?.version).toBe(before.version);
  });

  test("publish promotes the draft and counts a new served version", async () => {
    const id = await saveMail("lifecycle", "Entwurf zwei");
    await stack.http.writeOk(TemplateResolverHandlers.publish, { id }, admin);

    expect(await servedContent("lifecycle")).toContain("Entwurf zwei");
    const working = await findWorking(id);
    expect(working.status).toBe("active");
    expect(working.active?.version).toBe(working.version);
    const [stored] = await selectMany<TemplateResourceRow>(stack.db, templateResourcesTable, {
      id,
    });
    expect(stored?.draft).toBeNull();
    expect(stored?.activeVersion).toBe(stored?.version ?? -1);
  });

  test("discard-draft restores the served version and its number", async () => {
    const id = await saveMail("lifecycle", "Verworfen");
    const served = (await findWorking(id)).active?.version;

    await stack.http.writeOk(TemplateResolverHandlers.discardDraft, { id }, admin);

    const working = await findWorking(id);
    expect(working).toMatchObject({
      status: "active",
      version: served,
      active: { version: served },
    });
    expect(working.content).toContain("Entwurf zwei");
    const { rows } = await stack.http.queryOk<OverviewResponse>(
      TemplateResolverQueries.overview,
      {},
      admin,
    );
    expect(rows.find((row) => row.id === `mail|${slugOf("lifecycle")}`)).toMatchObject({
      status: "active",
      version: served,
      draftVersion: null,
    });
  });

  test("overview shows the served version and the draft beside it", async () => {
    await saveMail("lifecycle", "Noch ein Entwurf");
    const { rows } = await stack.http.queryOk<OverviewResponse>(
      TemplateResolverQueries.overview,
      {},
      admin,
    );
    const row = rows.find((candidate) => candidate.id === `mail|${slugOf("lifecycle")}`);
    expect(row?.status).toBe("active");
    expect(row?.draftVersion).toBeGreaterThan(row?.version ?? Number.POSITIVE_INFINITY);
    expect(row?.activeSince).not.toBeNull();
  });

  test("discard-draft without a draft is a validation error", async () => {
    const id = await saveMail("gate-free", "Aktiv", { status: "active" });
    const err = await stack.http.writeErr(TemplateResolverHandlers.discardDraft, { id }, admin);
    expect(validationCodes(err)).toEqual(["no_draft"]);
  });

  test("a draft that fails the publish gate saves, but publish is refused and the served version stays", async () => {
    const complete = '<p>Hi <span data-variable="name"></span></p>';
    const gated = (content: string, subject: string) => ({
      slug: slugOf("gated"),
      kind: "mail" as const,
      locale: "de",
      content,
      contentFormat: "html" as const,
      variableSchema: {},
      meta: { subject },
    });
    const { id } = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      { ...gated(complete, "Hallo"), status: "active" },
      admin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      gated("<p>ohne</p>", "Hallo"),
      admin,
    );

    const err = await stack.http.writeErr(TemplateResolverHandlers.publish, { id }, admin);
    expect(validationCodes(err)).toEqual(["missing_required_placeholder"]);
    const resolved = await createTemplateResolverApi(stack.db, stack.registry).resolveTemplate({
      tenantId,
      slug: slugOf("gated"),
      kind: "mail",
      locale: "de",
    });
    expect(resolved.content).toContain('data-variable="name"');
    expect((await findWorking(id)).status).toBe("draft");
  });

  test("a layout draft sits beside the active layout", async () => {
    const layout = {
      slug: "dd-layout",
      kind: "mail-layout" as const,
      locale: "de",
      contentFormat: "html" as const,
      variableSchema: {},
      meta: {},
    };
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      { ...layout, content: LAYOUT_ACTIVE, status: "active" },
      admin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      { ...layout, content: LAYOUT_DRAFT },
      admin,
    );

    const served = await createTemplateResolverApi(stack.db, stack.registry).resolveLayout({
      tenantId,
      slug: "dd-layout",
      kind: "mail-layout",
      locale: "de",
    });
    expect(served.content).toContain("Aktiver Kopf");
    const source = await stack.http.queryOk<LayoutSourceResponse>(
      TemplateResolverQueries.layoutSource,
      { kind: "mail-layout", slug: "dd-layout" },
      admin,
    );
    expect(source.tenant?.status).toBe("draft");
    expect(source.tenant?.active?.version).toBeGreaterThan(0);
    expect(source.regions.header).toContain("Entwurf Kopf");
  });

  test("copy-locale copies the open draft and lands beside an active target", async () => {
    await saveMail("copy", "Aktiv DE", { status: "active" });
    await saveMail("copy", "Entwurf DE");
    const targetId = await saveMail("copy", "Aktiv EN", { status: "active", locale: "en" });

    await stack.http.writeOk(
      TemplateResolverHandlers.copyLocale,
      { slug: slugOf("copy"), kind: "mail", fromLocale: "de", toLocale: "en", overwrite: true },
      admin,
    );

    expect(await servedContent("copy", "en")).toContain("Aktiv EN");
    const working = await findWorking(targetId);
    expect(working.status).toBe("draft");
    expect(working.content).toContain("Entwurf DE");
  });

  test("import-bundle over an active row lands as a draft beside it", async () => {
    const doc = {
      slug: "dd-mailer:doc",
      kind: "document-pdf" as const,
      locale: "de",
      content: "<p>Aktiv</p>",
      contentFormat: "html" as const,
      variableSchema: {},
    };
    const { id } = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertTenant,
      { ...doc, status: "active" },
      admin,
    );

    await stack.http.writeOk(
      TemplateResolverHandlers.importBundle,
      {
        bundle: {
          slug: doc.slug,
          kind: doc.kind,
          contentFormat: "html",
          locales: { de: { body: "<p>Import</p>" } },
        },
        overwrite: true,
      },
      admin,
    );

    const served = await createTemplateResolverApi(stack.db, stack.registry).resolveTemplate({
      tenantId,
      slug: doc.slug,
      kind: "document-pdf",
      locale: "de",
    });
    expect(served.content).toContain("Aktiv");
    const working = await findWorking(id);
    expect(working.status).toBe("draft");
    expect(working.content).toContain("Import");
  });

  test("tenant-overrides counts an active override with a draft as active, with its served version", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      mailPayload("counted", "System"),
      systemAdmin,
    );
    const id = await saveMail("counted", "Aktiv", { status: "active" });
    const served = (await findWorking(id)).version;
    await saveMail("counted", "Entwurf");
    const counts = await stack.http.queryOk<{
      activeOverrides: number;
      draftOverrides: number;
      rows: readonly { version: number }[];
      diff: { tenant: { templateVersion: number } } | null;
    }>(
      TemplateResolverQueries.tenantOverrides,
      { slug: slugOf("counted"), kind: "mail", diffTenantId: tenantId },
      systemAdmin,
    );
    expect(counts).toMatchObject({ activeOverrides: 1, draftOverrides: 0 });
    expect(counts.rows.map((row) => row.version)).toEqual([served]);
    expect(counts.diff?.tenant.templateVersion).toBe(served);
  });

  test("a row written before the draft columns gets its served version recorded on the first draft", async () => {
    const executor = createEventStoreExecutor(templateResourcesTable, templateResourceEntity, {
      entityName: "template-resource",
    });
    const created = await executor.create(
      {
        slug: slugOf("legacy"),
        kind: "mail",
        locale: "de",
        content: "<p>Alt</p>",
        contentFormat: "html",
        variableSchema: "{}",
        linkedResources: "{}",
        meta: JSON.stringify({ subject: "Alt" }),
        scope: "tenant",
        status: "active",
        tenantId,
      },
      admin,
      createTenantDb({ db: stack.db, tenantId }),
    );
    expect(created.isSuccess).toBe(true);
    const id = created.isSuccess ? String(created.data["id"]) : "";
    const legacy = await findWorking(id);
    expect(legacy.active?.version).toBe(legacy.version);

    await saveMail("legacy", "Neuer Entwurf");

    const working = await findWorking(id);
    expect(working.status).toBe("draft");
    expect(working.active?.version).toBe(legacy.version);
    expect(await servedContent("legacy")).toContain("Alt");
  });

  test("a system draft is discarded by discard-draft-system only", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      mailPayload("system", "Aktiv DE"),
      systemAdmin,
    );
    const { id } = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertSystem,
      mailPayload("system", "Aktiv EN", { locale: "en" }),
      systemAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.copyLocale,
      {
        slug: slugOf("system"),
        kind: "mail",
        fromLocale: "de",
        toLocale: "en",
        overwrite: true,
        scope: "system",
      },
      systemAdmin,
    );
    expect((await findWorking(id, systemAdmin)).status).toBe("draft");

    const refusedForTenant = await stack.http.writeErr(
      TemplateResolverHandlers.discardDraftSystem,
      { id },
      admin,
    );
    expect(refusedForTenant).toBeDefined();
    await stack.http.writeOk(TemplateResolverHandlers.discardDraftSystem, { id }, systemAdmin);

    const working = await findWorking(id, systemAdmin);
    expect(working.status).toBe("active");
    expect(working.content).toContain("Aktiv EN");
    const again = await stack.http.writeErr(
      TemplateResolverHandlers.discardDraftSystem,
      { id },
      systemAdmin,
    );
    expect(validationCodes(again)).toEqual(["no_draft"]);
  });

  test("a system draft never reaches a tenant, a SystemAdmin works on it", async () => {
    const copyToSystem = (fromLocale: string, toLocale: string) =>
      stack.http.writeOk<{ id: string }>(
        TemplateResolverHandlers.copyLocale,
        {
          slug: slugOf("sysdraft"),
          kind: "mail",
          fromLocale,
          toLocale,
          overwrite: true,
          scope: "system",
        },
        systemAdmin,
      );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      mailPayload("sysdraft", "Quelle EN", { locale: "en" }),
      systemAdmin,
    );
    const { id: systemId } = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.upsertSystem,
      mailPayload("sysdraft", "Aktiv DE"),
      systemAdmin,
    );
    await copyToSystem("en", "de");
    expect((await findWorking(systemId, systemAdmin)).content).toContain("Quelle EN");
    const { id: neverServedId } = await copyToSystem("en", "fr");
    expect((await findWorking(neverServedId, systemAdmin)).status).toBe("draft");

    const { rows } = await stack.http.queryOk<OverviewResponse>(
      TemplateResolverQueries.overview,
      {},
      admin,
    );
    expect(rows.find((row) => row.id === `mail|${slugOf("sysdraft")}`)).toMatchObject({
      origin: "system",
      status: "active",
      draftVersion: null,
      locales: ["de", "en"],
    });

    const copied = await stack.http.writeOk<{ id: string }>(
      TemplateResolverHandlers.copyLocale,
      { slug: slugOf("sysdraft"), kind: "mail", fromLocale: "de", toLocale: "fr" },
      admin,
    );
    expect((await findWorking(copied.id)).content).toContain("Aktiv DE");

    const seenByTenant = await findWorking(systemId);
    expect(seenByTenant.status).toBe("active");
    expect(seenByTenant.content).toContain("Aktiv DE");
    expect(seenByTenant.content).not.toContain("Quelle EN");
    expect(seenByTenant.meta).not.toContain("Quelle EN");

    expect(await findWorking(neverServedId)).toBeNull();
    const listedIds = (
      await stack.http.queryOk<readonly { id: string }[]>(
        TemplateResolverQueries.list,
        { kind: "mail" },
        admin,
      )
    ).map((row) => row.id);
    expect(listedIds).toContain(systemId);
    expect(listedIds).not.toContain(neverServedId);
    const diffError = await stack.http.queryErr(
      TemplateResolverQueries.diffToSystem,
      { id: copied.id },
      admin,
    );
    expect(diffError.code).toBe("not_found");
  });

  test("a system layout draft is shown to the SystemAdmin only", async () => {
    const layout = {
      slug: "dd-system-layout",
      kind: "mail-layout" as const,
      contentFormat: "html" as const,
      variableSchema: {},
      meta: {},
    };
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      { ...layout, locale: "en", content: LAYOUT_ACTIVE },
      systemAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      { ...layout, locale: "de", content: LAYOUT_DRAFT },
      systemAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.copyLocale,
      {
        slug: layout.slug,
        kind: layout.kind,
        fromLocale: "de",
        toLocale: "en",
        overwrite: true,
        scope: "system",
      },
      systemAdmin,
    );

    const sourceFor = (user: typeof admin) =>
      stack.http.queryOk<LayoutSourceResponse>(
        TemplateResolverQueries.layoutSource,
        { kind: layout.kind, slug: layout.slug, locale: "en" },
        user,
      );
    const forTenant = await sourceFor(admin);
    expect(forTenant.tenant).toBeNull();
    expect(forTenant.system?.status).toBe("active");
    expect(forTenant.regions.header).toContain("Aktiver Kopf");
    const forSystemAdmin = await sourceFor(systemAdmin);
    expect(forSystemAdmin.system?.status).toBe("draft");
    expect(forSystemAdmin.regions.header).toContain("Entwurf Kopf");

    await stack.http.writeOk(
      TemplateResolverHandlers.copyLocale,
      { slug: layout.slug, kind: layout.kind, fromLocale: "de", toLocale: "fr", scope: "system" },
      systemAdmin,
    );
    const frFor = (user: typeof admin) =>
      stack.http.queryOk<LayoutSourceResponse>(
        TemplateResolverQueries.layoutSource,
        { kind: layout.kind, slug: layout.slug, locale: "fr" },
        user,
      );
    expect((await frFor(admin)).system?.locale).toBe("de");
    expect((await frFor(systemAdmin)).system?.locale).toBe("fr");
  });

  test("re-seeding a system template keeps the recorded served version in step", async () => {
    const seed = (content: string) =>
      seedSystemTemplate(stack.db, {
        slug: "dd-seeded",
        kind: "ai-prompt",
        locale: "de",
        content,
        contentFormat: "plain",
        ifExists: "update",
      });
    const { id } = await seed("v1");
    await seed("v2");

    const working = await findWorking(id, systemAdmin);
    expect(working.content).toBe("v2");
    expect(working.version).toBeGreaterThan(1);
    expect(working.active?.version).toBe(working.version);
    const [stored] = await selectMany<TemplateResourceRow>(stack.db, templateResourcesTable, {
      id,
    });
    expect(stored?.activeVersion).toBe(stored?.version ?? -1);
  });

  test("re-seeding an archived text block keeps it archived", async () => {
    const seed = (content: string) =>
      seedTextBlock(stack.db, {
        tenantId,
        slug: "dd-seeded-block",
        locale: "de",
        title: "Block",
        content,
        ifExists: "update",
      });
    const { id } = await seed("v1");
    await stack.http.writeOk(TemplateResolverHandlers.archive, { id }, admin);
    await seed("v2");

    const [stored] = await selectMany<TemplateResourceRow>(stack.db, templateResourcesTable, {
      id,
    });
    expect(stored?.content).toBe("v2");
    expect(stored?.status).toBe("archived");
  });

  test("rebuilding the projection reproduces rows with drafts and served versions", async () => {
    await saveMail("snap", "Eins", { status: "active" });
    const id = await saveMail("snap", "Zwei");
    await stack.http.writeOk(TemplateResolverHandlers.publish, { id }, admin);
    await saveMail("snap", "Drei");
    await stack.http.writeOk(TemplateResolverHandlers.discardDraft, { id }, admin);
    await saveMail("snap", "Vier");

    const snapshot = async () =>
      JSON.parse(
        JSON.stringify(
          [...(await selectMany<TemplateResourceRow>(stack.db, templateResourcesTable, {}))].sort(
            (a, b) => String(a.id).localeCompare(String(b.id)),
          ),
        ),
      );
    const before = await snapshot();
    expect(before.some((row: TemplateResourceRow) => row.draft !== null)).toBe(true);

    await rebuildProjection("template-resolver:projection:template-resource-entity", {
      db: stack.db,
      registry: createRegistry([
        createTemplateResolverFeature({ tenantEditable: TENANT_EDITABLE }),
        mailer,
      ]),
    });

    expect(await snapshot()).toEqual(before);
  });
});
