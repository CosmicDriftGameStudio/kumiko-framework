import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { FALLBACK_LOCALE } from "../constants.js";
import { type LayoutRegions, readLayoutRegions } from "../layout-regions.js";
import { type TemplateResourceRow, templateResourcesTable } from "../table.js";
import { type MailLayoutMeta, readMailLayoutMeta } from "../template-meta.js";
import { localeSchema, templateSlugSchema } from "./shared.js";
import { parseStoredJson } from "./template-gates.js";

export type LayoutSourceRow = {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly locale: string;
};

export type LayoutSourceResponse = {
  readonly tenant: LayoutSourceRow | null;
  readonly system: (LayoutSourceRow & { readonly contentFormat: string }) | null;
  readonly regions: LayoutRegions;
  readonly effectiveFormat: "html" | "mjml" | null;
  readonly mjmlSource: string | null;
  /** Appearance of the effective mail layout; invalid stored meta reads as defaults (empty). */
  readonly meta: MailLayoutMeta;
  readonly locale: string;
};

const EMPTY_REGIONS: LayoutRegions = { header: "", signature: "", footer: "" };

function pickByLocale(
  rows: readonly TemplateResourceRow[],
  requested: string | undefined,
): TemplateResourceRow | null {
  const live = rows.filter((row) => row.status !== "archived");
  const candidates = live.length > 0 ? live : rows;
  return (
    candidates.find((row) => row.locale === requested) ??
    candidates.find((row) => row.locale === FALLBACK_LOCALE) ??
    candidates[0] ??
    null
  );
}

function toSourceRow(row: TemplateResourceRow): LayoutSourceRow {
  return { id: String(row.id), version: row.version, status: row.status, locale: row.locale };
}

function layoutFormat(row: TemplateResourceRow): "html" | "mjml" | null {
  return row.contentFormat === "html" || row.contentFormat === "mjml" ? row.contentFormat : null;
}

function pickEditedRows(
  rows: readonly TemplateResourceRow[],
  isSystemAdmin: boolean,
  locale: string | undefined,
): {
  readonly tenantRow: TemplateResourceRow | null;
  readonly systemRow: TemplateResourceRow | null;
} {
  const tenantRow = isSystemAdmin
    ? null
    : pickByLocale(
        rows.filter((row) => row.scope === "tenant"),
        locale,
      );
  const systemRow = pickByLocale(
    rows.filter((row) => row.scope === "system"),
    locale,
  );
  return { tenantRow, systemRow };
}

function readEffectiveRegions(
  effective: TemplateResourceRow | null,
  effectiveFormat: "html" | "mjml" | null,
): LayoutRegions {
  return effective !== null && effectiveFormat === "html"
    ? readLayoutRegions(effective.content ?? "")
    : EMPTY_REGIONS;
}

function readMjmlSource(
  systemRow: TemplateResourceRow | null,
  isSystemAdmin: boolean,
): string | null {
  const exposesMjml = isSystemAdmin && systemRow !== null && layoutFormat(systemRow) === "mjml";
  return exposesMjml ? (systemRow.content ?? "") : null;
}

function buildLayoutSource(input: {
  readonly kind: "mail-layout" | "pdf-layout";
  readonly locale: string | undefined;
  readonly isSystemAdmin: boolean;
  readonly tenantRow: TemplateResourceRow | null;
  readonly systemRow: TemplateResourceRow | null;
}): LayoutSourceResponse {
  const { kind, locale, isSystemAdmin, tenantRow, systemRow } = input;
  const effective = tenantRow ?? systemRow;
  const effectiveFormat = effective === null ? null : layoutFormat(effective);
  return {
    tenant: tenantRow === null ? null : toSourceRow(tenantRow),
    system:
      systemRow === null
        ? null
        : { ...toSourceRow(systemRow), contentFormat: systemRow.contentFormat },
    regions: readEffectiveRegions(effective, effectiveFormat),
    effectiveFormat,
    mjmlSource: readMjmlSource(systemRow, isSystemAdmin),
    meta:
      kind === "mail-layout" ? readMailLayoutMeta(parseStoredJson(effective?.meta ?? null)) : {},
    locale: effective?.locale ?? locale ?? FALLBACK_LOCALE,
  };
}

export const layoutSourceQuery = defineQueryHandler({
  name: "layout-source",
  schema: z.object({
    kind: z.enum(["mail-layout", "pdf-layout"]),
    slug: templateSlugSchema.default("default"),
    locale: localeSchema.optional(),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Reads the layout the caller edits: the tenant's own version and the system version of one layout slug, the header, signature and footer regions of the effective html version, and the locale a save has to use; a SystemAdmin edits the system version and also receives its mjml source. Use it to load the layout editor.",
  handler: async (query, ctx): Promise<LayoutSourceResponse> => {
    const { kind, slug, locale } = query.payload;
    const isSystemAdmin = query.user.roles.includes("SystemAdmin");
    const rows = await selectMany<TemplateResourceRow>(ctx.db, templateResourcesTable, {
      kind,
      slug,
    });
    const { tenantRow, systemRow } = pickEditedRows(rows, isSystemAdmin, locale);
    return buildLayoutSource({ kind, locale, isSystemAdmin, tenantRow, systemRow });
  },
});
