import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { LOCALE_HEADER_NAME } from "@cosmicdrift/kumiko-framework/api";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createTemplateResolverFeature } from "../feature.ts";
import type { OverviewResponse } from "../index.ts";
import { seedSystemTemplate } from "../seeding.ts";
import { templateResourceEntity } from "../table.ts";
import { TemplateResolverQueries } from "../web/qualified-names.ts";

const TITLE_KEY = "money-horse:template.creditSchedule.title";
const KEYED_SLUG = "money-horse:credit-schedule";
const PLAIN_SLUG = "money-horse:rent-invoice";

const moneyHorse = defineFeature("money-horse", (r) => {
  r.translations({
    keys: { [TITLE_KEY]: { de: "Tilgungsplan", en: "Credit repayment schedule" } },
  });
});

let stack: TestStack;

async function searchRows(search: string, locale: string): Promise<readonly string[]> {
  const response = await stack.http.queryWithHeaders(
    TemplateResolverQueries.overview,
    { search },
    TestUsers.systemAdmin,
    { [LOCALE_HEADER_NAME]: locale },
  );
  const body = (await response.json()) as { data: OverviewResponse };
  return body.data.rows.map((row) => row.slug);
}

beforeAll(async () => {
  stack = await setupTestStack({ features: [createTemplateResolverFeature(), moneyHorse] });
  await unsafeCreateEntityTable(stack.db, templateResourceEntity);
  const common = {
    kind: "document-pdf",
    locale: "de",
    content: "<p>Tilgungsplan</p>",
    contentFormat: "html",
  } as const;
  await seedSystemTemplate(stack.db, { ...common, slug: KEYED_SLUG, titleI18nKey: TITLE_KEY });
  await seedSystemTemplate(stack.db, { ...common, slug: PLAIN_SLUG });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("seeded system template titleI18nKey", () => {
  test("the overview lists the key as the title of a keyed template and the slug otherwise", async () => {
    const response = await stack.http.queryOk<OverviewResponse>(
      TemplateResolverQueries.overview,
      {},
      TestUsers.systemAdmin,
    );

    const titleOf = (slug: string) => response.rows.find((row) => row.slug === slug)?.title;
    expect(titleOf(KEYED_SLUG)).toBe(TITLE_KEY);
    expect(titleOf(PLAIN_SLUG)).toBe(PLAIN_SLUG);
  });

  test("the search matches the title in the request locale, not only the stored key", async () => {
    expect(await searchRows("Tilgungsplan", "de")).toEqual([KEYED_SLUG]);
    expect(await searchRows("repayment schedule", "en")).toEqual([KEYED_SLUG]);
    expect(await searchRows("Tilgungsplan", "en")).toEqual([]);
  });

  test("a titleI18nKey that is free text instead of a namespace:key is rejected", async () => {
    await expect(
      seedSystemTemplate(stack.db, {
        slug: "money-horse:free-text",
        kind: "document-pdf",
        locale: "de",
        content: "<p>x</p>",
        contentFormat: "html",
        titleI18nKey: "Tilgungsplan fuer Kredite",
      }),
    ).rejects.toThrow(/not a "namespace:key" i18n key/);
  });

  test("title and titleI18nKey together are rejected", async () => {
    await expect(
      seedSystemTemplate(stack.db, {
        slug: "money-horse:both",
        kind: "document-pdf",
        locale: "de",
        content: "<p>x</p>",
        contentFormat: "html",
        title: "Plain",
        titleI18nKey: TITLE_KEY,
      }),
    ).rejects.toThrow(/either title or titleI18nKey/);
  });
});
