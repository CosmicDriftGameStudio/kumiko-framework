import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createTemplateResolverFeature } from "../feature.ts";
import type { LayoutSourceResponse, OverviewResponse } from "../index.ts";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../qualified-names.ts";
import { templateResourceEntity } from "../table.ts";
import { tenantEditableTemplates } from "./tenant-editable-fixture.ts";

const MAIL_SLUG = "billing-ov:notify:invoice-issued";
const REMINDER_SLUG = "billing-ov:notify:payment-reminder";
const PDF_SLUG = "billing-ov:invoice";

const billing = defineFeature("billing-ov", (r) => {
  r.writeHandler({
    name: "issue",
    schema: z.object({}),
    access: { roles: ["TenantAdmin"] },
    handler: async () => ({ isSuccess: true as const, data: {} }),
  });
  r.notification("invoice-issued", {
    trigger: { on: "issue" },
    recipient: () => null,
    data: () => ({}),
    template: { de: { body: "<p>Rechnung</p>" } },
    meta: { de: { subject: "Rechnung" } },
  });
  r.notification("payment-reminder", {
    trigger: { on: "issue" },
    recipient: () => null,
    data: () => ({}),
    template: { de: { body: "<p>Erinnerung</p>" } },
    meta: { de: { subject: "Erinnerung" } },
  });
});

const systemAdmin = TestUsers.systemAdmin;
const TENANT_EDITABLE = tenantEditableTemplates(
  ["mail", "document-pdf", "mail-layout", "pdf-layout"],
  [MAIL_SLUG, PDF_SLUG, REMINDER_SLUG, "default"],
);

const adminA = createTestUser({ id: 2, roles: ["TenantAdmin"], tenantId: testTenantId(10) });
const adminB = createTestUser({ id: 3, roles: ["TenantAdmin"], tenantId: testTenantId(20) });

const MJML_LAYOUT =
  "<mjml><mj-body><mj-section><mj-column><mj-raw>{{{content}}}</mj-raw></mj-column></mj-section></mj-body></mjml>";
const TENANT_LAYOUT =
  "<div data-header><p>Nordlicht Kopf</p></div><div data-content></div><div data-signature><p>Mit freundlichen Grüßen</p></div><div data-footer><p>Impressum</p></div>";

let stack: TestStack;

function base(slug: string, kind: string, extra: Record<string, unknown> = {}) {
  return {
    slug,
    kind,
    locale: "de",
    contentFormat: "html" as const,
    variableSchema: {},
    linkedResources: {},
    ...extra,
  };
}

async function overview(
  user: typeof adminA,
  payload: Record<string, unknown> = {},
): Promise<OverviewResponse> {
  return (await stack.http.queryOk(
    TemplateResolverQueries.overview,
    payload,
    user,
  )) as OverviewResponse;
}

async function layoutSource(user: typeof adminA, payload: Record<string, unknown>) {
  return (await stack.http.queryOk(
    TemplateResolverQueries.layoutSource,
    payload,
    user,
  )) as LayoutSourceResponse;
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createTemplateResolverFeature({ tenantEditable: TENANT_EDITABLE }), billing],
  });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
  const write = (handler: string, payload: Record<string, unknown>, user: typeof adminA) =>
    stack.http.writeOk(handler, payload, user);

  await write(
    TemplateResolverHandlers.upsertSystem,
    base(MAIL_SLUG, "mail", {
      meta: { subject: "System" },
      content: "<p>System</p>",
      title: "Rechnung",
    }),
    systemAdmin,
  );
  await write(
    TemplateResolverHandlers.upsertSystem,
    base(MAIL_SLUG, "mail", {
      locale: "en",
      meta: { subject: "System" },
      content: "<p>System</p>",
    }),
    systemAdmin,
  );
  await write(
    TemplateResolverHandlers.upsertSystem,
    base(PDF_SLUG, "document-pdf", { content: "<p>Rechnung</p>", title: "Rechnung (PDF)" }),
    systemAdmin,
  );
  await write(
    TemplateResolverHandlers.upsertSystem,
    base("default", "mail-layout", {
      locale: "en",
      contentFormat: "mjml",
      content: MJML_LAYOUT,
      meta: {},
    }),
    systemAdmin,
  );
  await write(
    TemplateResolverHandlers.upsertTenant,
    base(MAIL_SLUG, "mail", {
      meta: { subject: "Eigene" },
      content: "<p>Eigene</p>",
      title: "Rechnung versendet",
    }),
    adminA,
  );
  await write(
    TemplateResolverHandlers.upsertTenant,
    base(REMINDER_SLUG, "mail", {
      meta: { subject: "Erinnerung" },
      content: "<p>Erinnerung</p>",
      title: "Zahlungserinnerung",
      status: "active",
    }),
    adminA,
  );
  await write(
    TemplateResolverHandlers.upsertTenant,
    base("default", "mail-layout", { content: TENANT_LAYOUT, meta: {} }),
    adminA,
  );
});

afterAll(async () => {
  await stack.cleanup();
});

describe("template-resolver :: overview", () => {
  test("groups rows per slug and kind with origin, locales, status and version", async () => {
    const { rows, total } = await overview(adminA);
    expect(total).toBe(rows.length);
    const invoiceMail = rows.find((row) => row.id === `mail|${MAIL_SLUG}`);
    expect(invoiceMail).toMatchObject({
      title: "Rechnung versendet",
      origin: "tenant",
      locales: ["de"],
      status: "draft",
      kindGroup: "mail",
      layoutSlug: "default",
    });
    expect(invoiceMail?.systemVersion).toBeGreaterThan(0);
    expect(invoiceMail?.usedBy.map((entry) => entry.qualifiedName)).toEqual([MAIL_SLUG]);

    const reminder = rows.find((row) => row.id === `mail|${REMINDER_SLUG}`);
    expect(reminder).toMatchObject({ origin: "tenant", status: "active", systemVersion: null });

    const pdf = rows.find((row) => row.id === `document-pdf|${PDF_SLUG}`);
    expect(pdf).toMatchObject({ origin: "system", title: "Rechnung (PDF)", usedByCount: 0 });
  });

  test("system rows keep their own locales and a tenant layout counts the notifications using it", async () => {
    const { rows } = await overview(adminB);
    const mail = rows.find((row) => row.id === `mail|${MAIL_SLUG}`);
    expect(mail).toMatchObject({ origin: "system", locales: ["de", "en"] });
    const layoutB = rows.find((row) => row.id === "mail-layout|default");
    expect(layoutB).toMatchObject({ origin: "system", locales: ["en"] });
    const layoutA = (await overview(adminA)).rows.find((row) => row.id === "mail-layout|default");
    expect(layoutA).toMatchObject({ origin: "tenant", usedByCount: 2 });
  });

  test("tenant B never sees the rows of tenant A", async () => {
    const { rows } = await overview(adminB);
    expect(rows.find((row) => row.id === `mail|${REMINDER_SLUG}`)).toBeUndefined();
    expect(rows.find((row) => row.id === `mail|${MAIL_SLUG}`)?.origin).toBe("system");
  });

  test("search, facets and paging narrow the list", async () => {
    const searched = await overview(adminA, { search: "erinnerung" });
    expect(searched.rows.map((row) => row.id)).toEqual([`mail|${REMINDER_SLUG}`]);

    const faceted = await overview(adminA, {
      filters: [
        { field: "kindGroup", op: "in", value: ["mail"] },
        { field: "status", op: "in", value: ["active"] },
      ],
    });
    expect(faceted.rows.map((row) => row.id)).toEqual([`mail|${REMINDER_SLUG}`]);

    const first = await overview(adminA, { limit: 1, sort: "slug", sortDirection: "asc" });
    const second = await overview(adminA, {
      limit: 1,
      offset: 1,
      sort: "slug",
      sortDirection: "asc",
    });
    expect(first.total).toBe(second.total);
    expect(first.rows[0]?.id).not.toBe(second.rows[0]?.id);
  });
});

describe("template-resolver :: overview layoutSlug filter", () => {
  test("layoutSlug keeps only the documents using that layout and counts them in total", async () => {
    const users = await overview(adminA, {
      layoutSlug: "default",
      filters: [{ field: "kind", op: "in", value: ["mail"] }],
    });
    expect(users.rows.map((row) => row.id).sort()).toEqual(
      [`mail|${MAIL_SLUG}`, `mail|${REMINDER_SLUG}`].sort(),
    );
    expect(users.total).toBe(2);

    const none = await overview(adminA, { layoutSlug: "no-such-layout" });
    expect(none.rows).toEqual([]);
    expect(none.total).toBe(0);
  });
});

describe("template-resolver :: layout-source", () => {
  test("a TenantAdmin gets the regions of the own html version and no mjml source", async () => {
    const source = await layoutSource(adminA, { kind: "mail-layout" });
    expect(source.tenant).toMatchObject({ locale: "de", status: "draft" });
    expect(source.system).toMatchObject({ locale: "en", contentFormat: "mjml" });
    expect(source.effectiveFormat).toBe("html");
    expect(source.regions).toEqual({
      header: "<p>Nordlicht Kopf</p>",
      signature: "<p>Mit freundlichen Grüßen</p>",
      footer: "<p>Impressum</p>",
    });
    expect(source.mjmlSource).toBeNull();
    expect(source.locale).toBe("de");
  });

  test("a tenant without an own version sees empty regions and saves under the system locale", async () => {
    const source = await layoutSource(adminB, { kind: "mail-layout" });
    expect(source.tenant).toBeNull();
    expect(source.effectiveFormat).toBe("mjml");
    expect(source.regions).toEqual({ header: "", signature: "", footer: "" });
    expect(source.mjmlSource).toBeNull();
    expect(source.locale).toBe("en");
  });

  test("a SystemAdmin gets the mjml source of the system version", async () => {
    const source = await layoutSource(systemAdmin, { kind: "mail-layout" });
    expect(source.tenant).toBeNull();
    expect(source.mjmlSource).toBe(MJML_LAYOUT);
  });

  test("a missing layout falls back to the requested locale", async () => {
    const source = await layoutSource(adminA, { kind: "pdf-layout", locale: "fr" });
    expect(source).toMatchObject({
      tenant: null,
      system: null,
      effectiveFormat: null,
      locale: "fr",
    });
  });
});
