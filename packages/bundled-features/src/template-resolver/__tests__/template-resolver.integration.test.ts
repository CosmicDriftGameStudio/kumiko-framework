import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { seedRow } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createTemplateResolverApi,
  TemplateNotFoundError,
  type TemplateResolverApi,
} from "../api.ts";
import { createTemplateResolverFeature } from "../feature.ts";
import { templateResourceEntity, templateResourcesTable } from "../table.ts";
import {
  type ContentFormat,
  FALLBACK_LOCALE,
  SYSTEM_TENANT_ID,
  type TemplateKind,
  type TemplateScope,
  type TemplateStatus,
} from "../web/constants.ts";

let stack: TestStack;
let db: DbConnection;
let api: TemplateResolverApi;

// Fixed UUIDs für reproducierbare Tests. tenantId-Spalte ist UUID-Typ
// (per buildBaseColumns), String-Sentinels werden von Postgres rejected.
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

// Tenant overrides are only delivered for unlocked templates, so every slug whose tenant row this
// file expects to win is listed here.
const unlockedSlugs: readonly (readonly [TemplateKind, readonly string[]])[] = [
  [
    "mail",
    [
      "active-test",
      "archived-test",
      "draft-test",
      "exact-1",
      "fallback-1",
      "fallback-2",
      "fallback-3",
      "fallback-4",
      "isolation-find",
      "isolation-test",
      "json-test",
      "locale-priority",
      "parent-test",
      "priority-test",
      "skip-1",
      "skip-2",
      "skip-3",
      "skip-4",
    ],
  ],
  ["document-pdf", ["exact-system", "json-empty"]],
  ["mail-layout", ["rl-1", "rl-2", "rl-3", "rl-4", "rl-5", "rl-6", "rl-none"]],
];

const feature = createTemplateResolverFeature({
  tenantEditable: unlockedSlugs.flatMap(([kind, slugs]) =>
    slugs.map((slug) => ({ kind, slug, access: { roles: ["TenantAdmin"] } })),
  ),
});

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  db = stack.db;
  await unsafeCreateEntityTable(db, templateResourceEntity);
  api = createTemplateResolverApi(db, stack.registry);
});

afterAll(async () => {
  await stack.cleanup();
});

// Direct-DB-Seed-Helper. Umgeht Write-Handlers (kommen in späterem Sprint).
// Pro Aufruf eine eindeutige (tenantId, slug, kind, locale)-Kombination
// erwartet — sonst Unique-Constraint-Verletzung.
async function seedTemplate(args: {
  tenantId: string;
  slug: string;
  kind: TemplateKind;
  locale: string;
  scope: TemplateScope;
  status?: TemplateStatus;
  content?: string;
  contentFormat?: ContentFormat;
  variableSchema?: Record<string, unknown>;
  linkedResources?: Record<string, string>;
  parentTemplateId?: string;
}) {
  await seedRow(db, templateResourcesTable, {
    tenantId: args.tenantId,
    slug: args.slug,
    kind: args.kind,
    locale: args.locale,
    scope: args.scope,
    status: args.status ?? "active",
    content: args.content ?? `content for ${args.slug} (${args.locale})`,
    contentFormat: args.contentFormat ?? "markdown",
    variableSchema: JSON.stringify(args.variableSchema ?? {}),
    linkedResources: JSON.stringify(args.linkedResources ?? {}),
    parentTemplateId: args.parentTemplateId ?? null,
    insertedById: "test",
    modifiedById: "test",
  });
}

describe("template-resolver :: findExact", () => {
  test("findet existierendes Template", async () => {
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "exact-1",
      kind: "mail",
      locale: "de",
      scope: "tenant",
    });
    const result = await api.findExact({
      tenantId: TENANT_A,
      slug: "exact-1",
      kind: "mail",
      locale: "de",
    });
    expect(result).not.toBeNull();
    expect(result?.slug).toBe("exact-1");
    expect(result?.locale).toBe("de");
    expect(result?.tenantId).toBe(TENANT_A);
  });

  test("returnt null wenn Template nicht existiert", async () => {
    const result = await api.findExact({
      tenantId: TENANT_A,
      slug: "does-not-exist",
      kind: "mail",
      locale: "de",
    });
    expect(result).toBeNull();
  });

  test("scope='system' liest aus SYSTEM_TENANT_ID, nicht aus Caller-Tenant", async () => {
    await seedTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: "exact-system",
      kind: "document-pdf",
      locale: "de",
      scope: "system",
    });
    const result = await api.findExact({
      tenantId: TENANT_A,
      slug: "exact-system",
      kind: "document-pdf",
      locale: "de",
      scope: "system",
    });
    expect(result).not.toBeNull();
    expect(result?.tenantId).toBe(SYSTEM_TENANT_ID);
  });
});

describe("template-resolver :: resolveTemplate :: 4-Stufen-Fallback", () => {
  test("Stufe 1: tenant + requested locale", async () => {
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "fallback-1",
      kind: "mail",
      locale: "de",
      scope: "tenant",
      content: "tenant-de-content",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "fallback-1",
      kind: "mail",
      locale: "de",
    });
    expect(result.content).toBe("tenant-de-content");
    expect(result.scope).toBe("tenant");
  });

  test("Stufe 2: system + requested locale (wenn kein Tenant-Override)", async () => {
    await seedTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: "fallback-2",
      kind: "mail",
      locale: "tr",
      scope: "system",
      content: "system-tr-content",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "fallback-2",
      kind: "mail",
      locale: "tr",
    });
    expect(result.content).toBe("system-tr-content");
    expect(result.scope).toBe("system");
    expect(result.locale).toBe("tr");
  });

  test("Stufe 3: tenant + FALLBACK_LOCALE (wenn requested locale fehlt überall)", async () => {
    // Kein tr und kein system-tr — nur tenant-de existiert
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "fallback-3",
      kind: "mail",
      locale: FALLBACK_LOCALE,
      scope: "tenant",
      content: "tenant-fallback-content",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "fallback-3",
      kind: "mail",
      locale: "tr",
    });
    expect(result.content).toBe("tenant-fallback-content");
    expect(result.locale).toBe(FALLBACK_LOCALE);
  });

  test("Stufe 4: system + FALLBACK_LOCALE (letzte Rettung)", async () => {
    await seedTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: "fallback-4",
      kind: "mail",
      locale: FALLBACK_LOCALE,
      scope: "system",
      content: "system-fallback-content",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "fallback-4",
      kind: "mail",
      locale: "ar",
    });
    expect(result.content).toBe("system-fallback-content");
    expect(result.scope).toBe("system");
    expect(result.locale).toBe(FALLBACK_LOCALE);
  });

  test("Tenant-Override gewinnt vor System-Default (Stufe 1 vor Stufe 2)", async () => {
    await seedTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: "priority-test",
      kind: "mail",
      locale: "de",
      scope: "system",
      content: "system-default",
    });
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "priority-test",
      kind: "mail",
      locale: "de",
      scope: "tenant",
      content: "tenant-override",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "priority-test",
      kind: "mail",
      locale: "de",
    });
    expect(result.content).toBe("tenant-override");
    expect(result.scope).toBe("tenant");
  });

  test("Requested-Locale gewinnt vor Fallback-Locale (Stufe 2 vor Stufe 4)", async () => {
    await seedTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: "locale-priority",
      kind: "mail",
      locale: "tr",
      scope: "system",
      content: "system-tr",
    });
    await seedTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: "locale-priority",
      kind: "mail",
      locale: FALLBACK_LOCALE,
      scope: "system",
      content: "system-de",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "locale-priority",
      kind: "mail",
      locale: "tr",
    });
    expect(result.content).toBe("system-tr");
    expect(result.locale).toBe("tr");
  });

  test("wirft TemplateNotFoundError wenn nichts gefunden", async () => {
    await expect(
      api.resolveTemplate({
        tenantId: TENANT_A,
        slug: "completely-missing",
        kind: "mail",
        locale: "tr",
      }),
    ).rejects.toThrow(TemplateNotFoundError);
  });
});

describe("template-resolver :: fallback skips non-active rows", () => {
  test("Stage 1 tenant=draft → Stage 2 system=active wins", async () => {
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "skip-1",
      kind: "mail",
      locale: "de",
      scope: "tenant",
      status: "draft",
      content: "tenant-draft",
    });
    await seedTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: "skip-1",
      kind: "mail",
      locale: "de",
      scope: "system",
      status: "active",
      content: "system-active",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "skip-1",
      kind: "mail",
      locale: "de",
    });
    expect(result.content).toBe("system-active");
    expect(result.scope).toBe("system");
  });

  test("Stage 1 tenant=archived → Stage 2 system=active wins", async () => {
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "skip-2",
      kind: "mail",
      locale: "de",
      scope: "tenant",
      status: "archived",
    });
    await seedTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: "skip-2",
      kind: "mail",
      locale: "de",
      scope: "system",
      status: "active",
      content: "system-active",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "skip-2",
      kind: "mail",
      locale: "de",
    });
    expect(result.content).toBe("system-active");
  });

  test("Stages 1+2 inactive → Stage 3 tenant-fallback=active wins", async () => {
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "skip-3",
      kind: "mail",
      locale: "tr",
      scope: "tenant",
      status: "draft",
    });
    await seedTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: "skip-3",
      kind: "mail",
      locale: "tr",
      scope: "system",
      status: "archived",
    });
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "skip-3",
      kind: "mail",
      locale: FALLBACK_LOCALE,
      scope: "tenant",
      status: "active",
      content: "tenant-fallback-active",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "skip-3",
      kind: "mail",
      locale: "tr",
    });
    expect(result.content).toBe("tenant-fallback-active");
    expect(result.locale).toBe(FALLBACK_LOCALE);
  });

  test("alle Stages inactive → throws TemplateNotFoundError", async () => {
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "skip-4",
      kind: "mail",
      locale: "de",
      scope: "tenant",
      status: "archived",
    });
    await seedTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: "skip-4",
      kind: "mail",
      locale: "de",
      scope: "system",
      status: "draft",
    });
    await expect(
      api.resolveTemplate({
        tenantId: TENANT_A,
        slug: "skip-4",
        kind: "mail",
        locale: "de",
      }),
    ).rejects.toThrow(TemplateNotFoundError);
  });
});

describe("template-resolver :: status filtering", () => {
  test("ignoriert status='archived'", async () => {
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "archived-test",
      kind: "mail",
      locale: "de",
      scope: "tenant",
      status: "archived",
      content: "archived-content",
    });
    await expect(
      api.resolveTemplate({
        tenantId: TENANT_A,
        slug: "archived-test",
        kind: "mail",
        locale: "de",
      }),
    ).rejects.toThrow(TemplateNotFoundError);
  });

  test("ignoriert status='draft'", async () => {
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "draft-test",
      kind: "mail",
      locale: "de",
      scope: "tenant",
      status: "draft",
      content: "draft-content",
    });
    await expect(
      api.resolveTemplate({
        tenantId: TENANT_A,
        slug: "draft-test",
        kind: "mail",
        locale: "de",
      }),
    ).rejects.toThrow(TemplateNotFoundError);
  });

  test("findet status='active'", async () => {
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "active-test",
      kind: "mail",
      locale: "de",
      scope: "tenant",
      status: "active",
      content: "active-content",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "active-test",
      kind: "mail",
      locale: "de",
    });
    expect(result.content).toBe("active-content");
    expect(result.status).toBe("active");
  });
});

describe("template-resolver :: tenant-isolation", () => {
  test("Tenant B kann Tenant A's Template nicht via resolveTemplate sehen", async () => {
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "isolation-test",
      kind: "mail",
      locale: "de",
      scope: "tenant",
      content: "tenant-a-only",
    });
    // Tenant B kennt das Template nicht, fällt durch alle 4 Stufen → TemplateNotFoundError
    await expect(
      api.resolveTemplate({
        tenantId: TENANT_B,
        slug: "isolation-test",
        kind: "mail",
        locale: "de",
      }),
    ).rejects.toThrow(TemplateNotFoundError);
  });

  test("Tenant B kann Tenant A's Template nicht via findExact sehen", async () => {
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "isolation-find",
      kind: "mail",
      locale: "de",
      scope: "tenant",
    });
    const result = await api.findExact({
      tenantId: TENANT_B,
      slug: "isolation-find",
      kind: "mail",
      locale: "de",
    });
    expect(result).toBeNull();
  });
});

describe("template-resolver :: JSON-Parsing", () => {
  test("variableSchema + linkedResources werden geparsed", async () => {
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "json-test",
      kind: "mail",
      locale: "de",
      scope: "tenant",
      variableSchema: { rentalTenantName: { type: "string", example: "Frau Schmidt" } },
      linkedResources: { logo: "file_abc" },
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "json-test",
      kind: "mail",
      locale: "de",
    });
    expect(result.variableSchema).toEqual({
      rentalTenantName: { type: "string", example: "Frau Schmidt" },
    });
    expect(result.linkedResources).toEqual({ logo: "file_abc" });
  });

  test("leerer variableSchema + linkedResources sind leere Objekte (nicht undefined)", async () => {
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "json-empty",
      kind: "document-pdf",
      locale: "de",
      scope: "tenant",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "json-empty",
      kind: "document-pdf",
      locale: "de",
    });
    expect(result.variableSchema).toEqual({});
    expect(result.linkedResources).toEqual({});
  });
});

describe("template-resolver :: parentTemplateId", () => {
  test("Tenant-Override kann parentTemplateId auf System-Default zeigen", async () => {
    await seedTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: "parent-test",
      kind: "mail",
      locale: "de",
      scope: "system",
    });
    const systemTemplate = await api.findExact({
      tenantId: TENANT_A,
      slug: "parent-test",
      kind: "mail",
      locale: "de",
      scope: "system",
    });
    expect(systemTemplate).not.toBeNull();

    await seedTemplate({
      tenantId: TENANT_A,
      slug: "parent-test",
      kind: "mail",
      locale: "de",
      scope: "tenant",
      parentTemplateId: systemTemplate?.id ?? "",
    });
    const override = await api.findExact({
      tenantId: TENANT_A,
      slug: "parent-test",
      kind: "mail",
      locale: "de",
    });
    expect(override?.parentTemplateId).toBe(systemTemplate?.id);
  });
});

describe("template-resolver :: resolveLayout", () => {
  const layoutArgs = (slug: string, locale: string) => ({
    tenantId: TENANT_A,
    slug,
    kind: "mail-layout" as const,
    locale,
  });
  const layout = (
    slug: string,
    tenantId: string,
    scope: TemplateScope,
    locale: string,
    extra: { status?: TemplateStatus; content?: string } = {},
  ) =>
    seedTemplate({
      tenantId,
      slug,
      kind: "mail-layout",
      locale,
      scope,
      contentFormat: "html",
      ...extra,
    });

  test("a tenant layout in another locale beats the system layout in the requested locale", async () => {
    await layout("rl-1", TENANT_A, "tenant", "en", { content: "tenant-en" });
    await layout("rl-1", SYSTEM_TENANT_ID, "system", "de", { content: "system-de" });
    const found = await api.resolveLayout(layoutArgs("rl-1", "de"));
    expect(found.scope).toBe("tenant");
    expect(found.content).toBe("tenant-en");
  });

  test("the requested locale wins, then the fallback locale, within the tenant", async () => {
    await layout("rl-2", TENANT_A, "tenant", "en", { content: "tenant-en" });
    await layout("rl-2", TENANT_A, "tenant", FALLBACK_LOCALE, { content: "tenant-fallback" });
    await layout("rl-2", TENANT_A, "tenant", "es", { content: "tenant-es" });
    expect((await api.resolveLayout(layoutArgs("rl-2", "es"))).content).toBe("tenant-es");
    expect((await api.resolveLayout(layoutArgs("rl-2", "fr"))).content).toBe("tenant-fallback");
  });

  test("without a tenant row the system layout is used in any locale", async () => {
    await layout("rl-3", SYSTEM_TENANT_ID, "system", "en", { content: "system-en" });
    const found = await api.resolveLayout(layoutArgs("rl-3", "de"));
    expect(found.scope).toBe("system");
    expect(found.content).toBe("system-en");
  });

  test("another tenant's layout is never used", async () => {
    await layout("rl-4", TENANT_B, "tenant", "de", { content: "tenant-b" });
    await expect(api.resolveLayout(layoutArgs("rl-4", "de"))).rejects.toBeInstanceOf(
      TemplateNotFoundError,
    );
  });

  test("draft and archived rows are ignored", async () => {
    await layout("rl-5", TENANT_A, "tenant", "de", { status: "draft", content: "draft" });
    await layout("rl-5", TENANT_A, "tenant", "en", { status: "archived", content: "archived" });
    await layout("rl-5", SYSTEM_TENANT_ID, "system", "en", { content: "system-en" });
    expect((await api.resolveLayout(layoutArgs("rl-5", "de"))).content).toBe("system-en");
  });

  test("among several other locales the choice is stable: highest version, then locale order", async () => {
    await layout("rl-6", TENANT_A, "tenant", "fr", { content: "tenant-fr" });
    await layout("rl-6", TENANT_A, "tenant", "es", { content: "tenant-es" });
    expect((await api.resolveLayout(layoutArgs("rl-6", "de"))).content).toBe("tenant-es");
  });

  test("throws TemplateNotFoundError when no scope has an active layout", async () => {
    await expect(api.resolveLayout(layoutArgs("rl-none", "de"))).rejects.toBeInstanceOf(
      TemplateNotFoundError,
    );
  });
});
