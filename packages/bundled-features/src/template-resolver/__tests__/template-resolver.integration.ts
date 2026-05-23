import { insertOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTemplateResolverApi, TemplateNotFoundError, type TemplateResolverApi } from "../api";
import {
  type ContentFormat,
  FALLBACK_LOCALE,
  type RenderKind,
  SYSTEM_TENANT_ID,
  type TemplateScope,
  type TemplateStatus,
} from "../constants";
import { createTemplateResolverFeature } from "../feature";
import { templateResourceEntity, templateResourcesTable } from "../table";

let stack: TestStack;
let db: DbConnection;
let api: TemplateResolverApi;

// Fixed UUIDs für reproducierbare Tests. tenantId-Spalte ist UUID-Typ
// (per buildBaseColumns), String-Sentinels werden von Postgres rejected.
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

const feature = createTemplateResolverFeature();

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  db = stack.db;
  await unsafeCreateEntityTable(db, templateResourceEntity);
  api = createTemplateResolverApi(db);
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
  kind: RenderKind;
  locale: string;
  scope: TemplateScope;
  status?: TemplateStatus;
  content?: string;
  contentFormat?: ContentFormat;
  variableSchema?: Record<string, unknown>;
  linkedResources?: Record<string, string>;
  parentTemplateId?: string;
}) {
  await insertOne(db, templateResourcesTable, {
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
    createdBy: "test",
    updatedBy: "test",
  });
}

describe("template-resolver :: findExact", () => {
  test("findet existierendes Template", async () => {
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "exact-1",
      kind: "mail-html",
      locale: "de",
      scope: "tenant",
    });
    const result = await api.findExact({
      tenantId: TENANT_A,
      slug: "exact-1",
      kind: "mail-html",
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
      kind: "mail-html",
      locale: "de",
    });
    expect(result).toBeNull();
  });

  test("scope='system' liest aus SYSTEM_TENANT_ID, nicht aus Caller-Tenant", async () => {
    await seedTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: "exact-system",
      kind: "notification",
      locale: "de",
      scope: "system",
    });
    const result = await api.findExact({
      tenantId: TENANT_A,
      slug: "exact-system",
      kind: "notification",
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
      kind: "mail-html",
      locale: "de",
      scope: "tenant",
      content: "tenant-de-content",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "fallback-1",
      kind: "mail-html",
      locale: "de",
    });
    expect(result.content).toBe("tenant-de-content");
    expect(result.scope).toBe("tenant");
  });

  test("Stufe 2: system + requested locale (wenn kein Tenant-Override)", async () => {
    await seedTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: "fallback-2",
      kind: "mail-html",
      locale: "tr",
      scope: "system",
      content: "system-tr-content",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "fallback-2",
      kind: "mail-html",
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
      kind: "mail-html",
      locale: FALLBACK_LOCALE,
      scope: "tenant",
      content: "tenant-fallback-content",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "fallback-3",
      kind: "mail-html",
      locale: "tr",
    });
    expect(result.content).toBe("tenant-fallback-content");
    expect(result.locale).toBe(FALLBACK_LOCALE);
  });

  test("Stufe 4: system + FALLBACK_LOCALE (letzte Rettung)", async () => {
    await seedTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: "fallback-4",
      kind: "mail-html",
      locale: FALLBACK_LOCALE,
      scope: "system",
      content: "system-fallback-content",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "fallback-4",
      kind: "mail-html",
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
      kind: "mail-html",
      locale: "de",
      scope: "system",
      content: "system-default",
    });
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "priority-test",
      kind: "mail-html",
      locale: "de",
      scope: "tenant",
      content: "tenant-override",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "priority-test",
      kind: "mail-html",
      locale: "de",
    });
    expect(result.content).toBe("tenant-override");
    expect(result.scope).toBe("tenant");
  });

  test("Requested-Locale gewinnt vor Fallback-Locale (Stufe 2 vor Stufe 4)", async () => {
    await seedTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: "locale-priority",
      kind: "mail-html",
      locale: "tr",
      scope: "system",
      content: "system-tr",
    });
    await seedTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: "locale-priority",
      kind: "mail-html",
      locale: FALLBACK_LOCALE,
      scope: "system",
      content: "system-de",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "locale-priority",
      kind: "mail-html",
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
        kind: "mail-html",
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
      kind: "mail-html",
      locale: "de",
      scope: "tenant",
      status: "draft",
      content: "tenant-draft",
    });
    await seedTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: "skip-1",
      kind: "mail-html",
      locale: "de",
      scope: "system",
      status: "active",
      content: "system-active",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "skip-1",
      kind: "mail-html",
      locale: "de",
    });
    expect(result.content).toBe("system-active");
    expect(result.scope).toBe("system");
  });

  test("Stage 1 tenant=archived → Stage 2 system=active wins", async () => {
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "skip-2",
      kind: "mail-html",
      locale: "de",
      scope: "tenant",
      status: "archived",
    });
    await seedTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: "skip-2",
      kind: "mail-html",
      locale: "de",
      scope: "system",
      status: "active",
      content: "system-active",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "skip-2",
      kind: "mail-html",
      locale: "de",
    });
    expect(result.content).toBe("system-active");
  });

  test("Stages 1+2 inactive → Stage 3 tenant-fallback=active wins", async () => {
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "skip-3",
      kind: "mail-html",
      locale: "tr",
      scope: "tenant",
      status: "draft",
    });
    await seedTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: "skip-3",
      kind: "mail-html",
      locale: "tr",
      scope: "system",
      status: "archived",
    });
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "skip-3",
      kind: "mail-html",
      locale: FALLBACK_LOCALE,
      scope: "tenant",
      status: "active",
      content: "tenant-fallback-active",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "skip-3",
      kind: "mail-html",
      locale: "tr",
    });
    expect(result.content).toBe("tenant-fallback-active");
    expect(result.locale).toBe(FALLBACK_LOCALE);
  });

  test("alle Stages inactive → throws TemplateNotFoundError", async () => {
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "skip-4",
      kind: "mail-html",
      locale: "de",
      scope: "tenant",
      status: "archived",
    });
    await seedTemplate({
      tenantId: SYSTEM_TENANT_ID,
      slug: "skip-4",
      kind: "mail-html",
      locale: "de",
      scope: "system",
      status: "draft",
    });
    await expect(
      api.resolveTemplate({
        tenantId: TENANT_A,
        slug: "skip-4",
        kind: "mail-html",
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
      kind: "mail-html",
      locale: "de",
      scope: "tenant",
      status: "archived",
      content: "archived-content",
    });
    await expect(
      api.resolveTemplate({
        tenantId: TENANT_A,
        slug: "archived-test",
        kind: "mail-html",
        locale: "de",
      }),
    ).rejects.toThrow(TemplateNotFoundError);
  });

  test("ignoriert status='draft'", async () => {
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "draft-test",
      kind: "mail-html",
      locale: "de",
      scope: "tenant",
      status: "draft",
      content: "draft-content",
    });
    await expect(
      api.resolveTemplate({
        tenantId: TENANT_A,
        slug: "draft-test",
        kind: "mail-html",
        locale: "de",
      }),
    ).rejects.toThrow(TemplateNotFoundError);
  });

  test("findet status='active'", async () => {
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "active-test",
      kind: "mail-html",
      locale: "de",
      scope: "tenant",
      status: "active",
      content: "active-content",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "active-test",
      kind: "mail-html",
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
      kind: "mail-html",
      locale: "de",
      scope: "tenant",
      content: "tenant-a-only",
    });
    // Tenant B kennt das Template nicht, fällt durch alle 4 Stufen → TemplateNotFoundError
    await expect(
      api.resolveTemplate({
        tenantId: TENANT_B,
        slug: "isolation-test",
        kind: "mail-html",
        locale: "de",
      }),
    ).rejects.toThrow(TemplateNotFoundError);
  });

  test("Tenant B kann Tenant A's Template nicht via findExact sehen", async () => {
    await seedTemplate({
      tenantId: TENANT_A,
      slug: "isolation-find",
      kind: "mail-html",
      locale: "de",
      scope: "tenant",
    });
    const result = await api.findExact({
      tenantId: TENANT_B,
      slug: "isolation-find",
      kind: "mail-html",
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
      kind: "mail-html",
      locale: "de",
      scope: "tenant",
      variableSchema: { rentalTenantName: { type: "string", example: "Frau Schmidt" } },
      linkedResources: { logo: "file_abc" },
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "json-test",
      kind: "mail-html",
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
      kind: "notification",
      locale: "de",
      scope: "tenant",
    });
    const result = await api.resolveTemplate({
      tenantId: TENANT_A,
      slug: "json-empty",
      kind: "notification",
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
      kind: "mail-html",
      locale: "de",
      scope: "system",
    });
    const systemTemplate = await api.findExact({
      tenantId: TENANT_A,
      slug: "parent-test",
      kind: "mail-html",
      locale: "de",
      scope: "system",
    });
    expect(systemTemplate).not.toBeNull();

    await seedTemplate({
      tenantId: TENANT_A,
      slug: "parent-test",
      kind: "mail-html",
      locale: "de",
      scope: "tenant",
      parentTemplateId: systemTemplate?.id ?? "",
    });
    const override = await api.findExact({
      tenantId: TENANT_A,
      slug: "parent-test",
      kind: "mail-html",
      locale: "de",
    });
    expect(override?.parentTemplateId).toBe(systemTemplate?.id);
  });
});
