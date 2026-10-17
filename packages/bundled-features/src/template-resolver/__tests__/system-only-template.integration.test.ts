import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createTemplateResolverFeature } from "../feature.js";
import type { OverviewResponse } from "../index.js";
import { TemplateResolverHandlers, TemplateResolverQueries } from "../qualified-names.js";
import { templateResourceEntity } from "../table.js";

const SYSTEM_ONLY_SLUG = "account-so:notify:deletion-verification";
const EDITABLE_SLUG = "account-so:notify:welcome";

const account = defineFeature("account-so", (r) => {
  r.notification("deletion-verification", {
    systemOnly: true,
    template: { de: { body: "<p>Löschung bestätigen</p>" } },
    meta: { de: { subject: "Löschung" } },
  });
  r.notification("welcome", {
    template: { de: { body: "<p>Willkommen</p>" } },
    meta: { de: { subject: "Willkommen" } },
  });
});

const systemAdmin = TestUsers.systemAdmin;
const tenantAdmin = createTestUser({ id: 61, roles: ["TenantAdmin"], tenantId: testTenantId(61) });

function mailPayload(slug: string, content: string, extra: Record<string, unknown> = {}) {
  return {
    slug,
    kind: "mail",
    locale: "de",
    contentFormat: "html" as const,
    variableSchema: {},
    linkedResources: {},
    meta: { subject: "Betreff" },
    content,
    ...extra,
  };
}

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [createTemplateResolverFeature(), account] });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
  for (const slug of [SYSTEM_ONLY_SLUG, EDITABLE_SLUG]) {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      mailPayload(slug, "<p>System</p>", { title: slug }),
      systemAdmin,
    );
  }
});

afterAll(async () => {
  await stack.cleanup();
});

async function overviewSlugs(user: typeof tenantAdmin): Promise<readonly string[]> {
  const response = await stack.http.queryOk<OverviewResponse>(
    TemplateResolverQueries.overview,
    {},
    user,
  );
  return response.rows.map((row) => row.slug);
}

describe("template-resolver :: systemOnly notification templates", () => {
  test("a tenant admin's overview leaves the system-only template out, a SystemAdmin sees it", async () => {
    expect(await overviewSlugs(tenantAdmin)).toEqual([EDITABLE_SLUG]);
    expect(await overviewSlugs(systemAdmin)).toEqual(
      expect.arrayContaining([SYSTEM_ONLY_SLUG, EDITABLE_SLUG]),
    );
  });

  test("a tenant admin cannot open the system-only template by id", async () => {
    const systemRows = await stack.http.queryOk<readonly { id: string; slug: string }[]>(
      TemplateResolverQueries.list,
      {},
      systemAdmin,
    );
    const systemOnlyRow = systemRows.find((row) => row.slug === SYSTEM_ONLY_SLUG);
    expect(systemOnlyRow).toBeDefined();
    const found = await stack.http.queryOk(
      TemplateResolverQueries.findById,
      { id: systemOnlyRow?.id },
      tenantAdmin,
    );
    expect(found).toBeNull();
  });

  test("every tenant write path refuses an override of the system-only template", async () => {
    const attempts: readonly [string, Record<string, unknown>][] = [
      [TemplateResolverHandlers.upsertTenant, mailPayload(SYSTEM_ONLY_SLUG, "<p>Eigen</p>")],
      [
        TemplateResolverHandlers.copyLocale,
        { slug: SYSTEM_ONLY_SLUG, kind: "mail", fromLocale: "de", toLocale: "en" },
      ],
      [
        TemplateResolverHandlers.importBundle,
        {
          bundle: {
            slug: SYSTEM_ONLY_SLUG,
            kind: "mail",
            contentFormat: "html",
            locales: { de: { body: "<p>Eigen</p>", meta: { subject: "Eigen" } } },
          },
          overwrite: true,
        },
      ],
    ];
    for (const [handler, payload] of attempts) {
      const error = await stack.http.writeErr(handler, payload, tenantAdmin);
      expect({ handler, code: error.code, i18nKey: error.i18nKey }).toEqual({
        handler,
        code: "access_denied",
        i18nKey: "templateResolver.errors.systemOnlyTemplate",
      });
    }
  });

  test("a SystemAdmin cannot push an override into a tenant either", async () => {
    const error = await stack.http.writeErr(
      TemplateResolverHandlers.upsertTenant,
      mailPayload(SYSTEM_ONLY_SLUG, "<p>Eigen</p>", { tenantIdOverride: tenantAdmin.tenantId }),
      systemAdmin,
    );
    expect(error.i18nKey).toBe("templateResolver.errors.systemOnlyTemplate");
  });

  test("a SystemAdmin still edits the system template and a tenant still overrides other mails", async () => {
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertSystem,
      mailPayload(SYSTEM_ONLY_SLUG, "<p>System neu</p>"),
      systemAdmin,
    );
    await stack.http.writeOk(
      TemplateResolverHandlers.upsertTenant,
      mailPayload(EDITABLE_SLUG, "<p>Eigen</p>"),
      tenantAdmin,
    );
  });
});
