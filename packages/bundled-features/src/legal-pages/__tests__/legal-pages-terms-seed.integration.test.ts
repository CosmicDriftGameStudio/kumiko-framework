import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  createTemplateResolverApi,
  createTemplateResolverFeature,
  templateResourceEntity,
} from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { LEGAL_TERMS_ROUTES, legalPagePath } from "../constants.ts";
import { createLegalPagesFeature } from "../feature.ts";
import { createLegalPagesLayout } from "../layout.ts";
import { legalContentSeed } from "../seed.ts";

const FIXTURE_PATH = join(import.meta.dir, "fixtures", "legal-content.json");

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createTemplateResolverFeature(),
      createLegalPagesFeature({
        terms: true,
        wrapLayout: createLegalPagesLayout({
          siteName: "Test <App>",
          css: ".prose{max-width:40rem}",
          headerHtml: (lang, alternates) =>
            `<header data-lang="${lang}">nav</header><nav>${Object.entries(alternates ?? {})
              .map(([locale, path]) => `<a hreflang="${locale}" href="${path}">${locale}</a>`)
              .join("")}</nav>`,
          contentClass: "prose",
        }),
      }),
    ],
    anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
    extraContext: ({ db, registry }) => ({
      templateResolver: createTemplateResolverApi(db, registry),
    }),
  });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
  await legalContentSeed({ path: FIXTURE_PATH })({ db: stack.db });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("legal-pages terms routes with seeded content", () => {
  test("serves the seeded German terms inside the app layout", async () => {
    const res = await stack.app.request("/legal/nutzungsbedingungen");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<title>Nutzungsbedingungen · Test &lt;App&gt;</title>");
    expect(body).toContain('<header data-lang="de">nav</header>');
    expect(body).toContain('<main data-tenant-content class="prose">');
    expect(body).toContain("<strong>Testanwendung</strong>");
  });

  test("hands the other-language path of the same page to the layout", async () => {
    const body = await (await stack.app.request("/legal/nutzungsbedingungen")).text();
    expect(body).toContain(
      `<a hreflang="de" href="${LEGAL_TERMS_ROUTES[0]?.path}">de</a><a hreflang="en" href="${LEGAL_TERMS_ROUTES[1]?.path}">en</a>`,
    );
  });

  test("serves the seeded English terms", async () => {
    const res = await stack.app.request("/legal/terms");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('lang="en"');
    expect(body).toContain("<strong>test application</strong>");
  });

  test("re-seeding with changed blocks updates the served text", async () => {
    await legalContentSeed({
      blocks: [
        { slug: "terms", locale: "en", title: "Terms of Service", content: "Revised terms." },
      ],
    })({ db: stack.db });
    const body = await (await stack.app.request("/legal/terms")).text();
    expect(body).toContain("Revised terms.");
    expect(body).not.toContain("test application");
  });

  test("legalPagePath maps slug and locale to the served path", () => {
    expect(legalPagePath(LEGAL_TERMS_ROUTES, "terms", "de")).toBe("/legal/nutzungsbedingungen");
    expect(legalPagePath(LEGAL_TERMS_ROUTES, "terms", "es")).toBeUndefined();
  });

  test("a seed file that is not a block list fails loudly", async () => {
    const seed = legalContentSeed({
      path: join(import.meta.dir, "..", "..", "..", "package.json"),
    });
    await expect(seed({ db: stack.db })).rejects.toThrow("is not a list of");
  });
});
