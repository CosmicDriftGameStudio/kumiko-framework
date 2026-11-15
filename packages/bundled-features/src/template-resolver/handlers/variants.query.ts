import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { type TemplateResourceRow, templateResourcesTable } from "../table.ts";
import { deliveryPolicyOf, isRowServed } from "../template-delivery-policy.ts";
import {
  isVariantSlugOf,
  readVariantOf,
  VARIANT_KIND,
  VARIANT_SEPARATOR,
} from "../template-variants.ts";
import { ACTIVE_TEMPLATE_STATUS, FALLBACK_LOCALE, SYSTEM_TENANT_ID } from "../web/constants.ts";
import { localeSchema, templateSlugSchema } from "./shared.ts";
import { parseStoredJson } from "./template-gates.ts";

const VARIANT_ROW_LIMIT = 500;

export type VariantSummary = {
  readonly slug: string;
  readonly title: string | null;
  readonly scope: "system" | "tenant";
  readonly locale: string;
};

// Tenant rows win over system rows of the same slug, the requested locale over the fallback locale.
function precedence(row: TemplateResourceRow, locale: string): number {
  return (row.tenantId === SYSTEM_TENANT_ID ? 1 : 0) + (row.locale === locale ? 0 : 2);
}

export const variantsQuery = defineQueryHandler({
  name: "variants",
  schema: z.object({ baseSlug: templateSlugSchema, locale: localeSchema }),
  access: {
    openToAll: {
      reason:
        "lists only slug, title, scope and locale of the variants the caller's own tenant can print; " +
        "whoever may create a document from the base template must be able to pick a variant, " +
        "and the app's role names are unknown here",
    },
  },
  description:
    "Lists the active variants of a PDF document template (kind document-pdf, slug <baseSlug>:<name>) that the caller's tenant can use: the app's system variants and the tenant's own, each with slug, title (text or a translation key), scope (system or tenant) and locale. A tenant variant replaces a system variant of the same slug. Only published variants appear, and tenant variants only while the app still allows variants for the base template. Pass a returned slug as the variant when rendering the document.",
  handler: async (query, ctx) => {
    const { baseSlug, locale } = query.payload;
    const locales = locale === FALLBACK_LOCALE ? [locale] : [locale, FALLBACK_LOCALE];
    const rows: TemplateResourceRow[] = [];
    for (const rowLocale of locales) {
      const found = await selectMany<TemplateResourceRow>(
        ctx.db,
        templateResourcesTable,
        {
          kind: VARIANT_KIND,
          status: ACTIVE_TEMPLATE_STATUS,
          locale: rowLocale,
          tenantId: { in: [query.user.tenantId, SYSTEM_TENANT_ID] },
          // Slugs are kebab segments joined by ":", so the base slug holds no LIKE wildcard.
          slug: { like: `${baseSlug}${VARIANT_SEPARATOR}%` },
        },
        { limit: VARIANT_ROW_LIMIT },
      );
      rows.push(...found);
    }
    // Delivery does not depend on the caller: a SystemAdmin sees the same list as the tenant's users.
    const deliveryPolicy = deliveryPolicyOf(ctx.registry);
    const delivered = rows.filter(
      (row) =>
        isVariantSlugOf(row.slug, baseSlug) &&
        readVariantOf(parseStoredJson(row.meta)) === baseSlug &&
        isRowServed(deliveryPolicy, row),
    );
    const best = new Map<string, TemplateResourceRow>();
    for (const row of delivered) {
      const current = best.get(row.slug);
      if (current === undefined || precedence(row, locale) < precedence(current, locale)) {
        best.set(row.slug, row);
      }
    }
    return [...best.values()]
      .map(
        (row): VariantSummary => ({
          slug: row.slug,
          title: row.title,
          scope: row.tenantId === SYSTEM_TENANT_ID ? "system" : "tenant",
          locale: row.locale,
        }),
      )
      .sort((a, b) => a.slug.localeCompare(b.slug));
  },
});
