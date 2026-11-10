import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler, type HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { type TemplateResourceRow, templateResourcesTable } from "../table.ts";
import { deliveryPolicyOf } from "../template-delivery-policy.ts";
import { draftViewerTenantId, parseTemplateDraft, servedVersionOf } from "../template-draft.ts";
import type { TemplateEditPolicy } from "../template-edit-policy.ts";
import { templateSlugSchema } from "../template-meta.ts";
import { collectTemplateUsage } from "../template-usage.ts";
import { TEMPLATE_KINDS } from "../web/constants.ts";
import {
  effectiveMailLayoutSlugs,
  effectiveRowsOf,
  isRowVisibleToCaller,
  ownLayoutSlugOf,
} from "./overview.query.ts";
import { storedRecord } from "./template-gates.ts";
import { defaultPdfLayoutSlug } from "./tenant-settings.ts";

const USAGE_ROW_LIMIT = 5000;

export type PdfLayoutUser = {
  readonly slug: string;
  readonly locale: string;
  readonly title: string;
  readonly hasOwnLayout: boolean;
  readonly isSystem: boolean;
  /** "draft" when an open draft names this layout, else the served status. */
  readonly status: "draft" | "active";
  readonly version: number;
};

async function visibleRowsOfKind(
  ctx: HandlerContext,
  policy: TemplateEditPolicy,
  user: Parameters<typeof isRowVisibleToCaller>[1],
  kind: "mail" | "document-pdf",
): Promise<TemplateResourceRow[]> {
  const fetchedRows = await selectMany<TemplateResourceRow>(
    ctx.db,
    templateResourcesTable,
    { kind },
    { orderBy: { col: "id", direction: "asc" }, limit: USAGE_ROW_LIMIT + 1 },
  );
  if (fetchedRows.length > USAGE_ROW_LIMIT) {
    ctx.obs.log?.warn("template usage: row limit reached, result is incomplete", {
      limit: USAGE_ROW_LIMIT,
    });
  }
  return fetchedRows
    .slice(0, USAGE_ROW_LIMIT)
    .filter((row) => isRowVisibleToCaller(policy, user, ctx.registry, row));
}

// An open draft lives beside the served row, so its layout choice sits in the draft's own meta.
function draftLayoutOf(
  user: Parameters<typeof draftViewerTenantId>[0],
  row: TemplateResourceRow,
): { readonly layoutSlug: string | null } | null {
  if (row.tenantId !== draftViewerTenantId(user, row)) return null;
  const draft = parseTemplateDraft(row.draft);
  if (draft === null) return null;
  const layoutSlug = storedRecord(draft.meta)["layoutSlug"];
  return { layoutSlug: typeof layoutSlug === "string" ? layoutSlug : null };
}

function servedRowOf(
  group: readonly TemplateResourceRow[],
  policy: ReturnType<typeof deliveryPolicyOf>,
): { readonly served: TemplateResourceRow; readonly isSystem: boolean } | null {
  const effective = effectiveRowsOf(group, policy);
  if (effective === null || (effective.lockedOverride && effective.origin === "tenant"))
    return null;
  const served = effective.rows[0];
  if (served === undefined || served.status === "archived") return null;
  return { served, isSystem: effective.origin === "system" };
}

function pdfLayoutUserOf(
  group: readonly TemplateResourceRow[],
  layoutSlug: string,
  defaultSlug: string,
  policy: ReturnType<typeof deliveryPolicyOf>,
  user: Parameters<typeof draftViewerTenantId>[0],
): PdfLayoutUser | null {
  const found = servedRowOf(group, policy);
  if (found === null) return null;
  const { served, isSystem } = found;
  const ownLayout = ownLayoutSlugOf(served);
  const servedUses = (ownLayout ?? defaultSlug) === layoutSlug;
  const draft = draftLayoutOf(user, served);
  const draftUses = draft !== null && (draft.layoutSlug ?? defaultSlug) === layoutSlug;
  if (!servedUses && !draftUses) return null;
  return {
    slug: served.slug,
    locale: served.locale,
    title: served.title ?? served.slug,
    hasOwnLayout: draftUses ? draft.layoutSlug !== null : ownLayout !== null,
    isSystem,
    status: draftUses || served.status === "draft" ? "draft" : "active",
    version: draftUses ? served.version : servedVersionOf(served),
  };
}

// The served version of every document and locale decides: its own layout, else the tenant default.
// A saved draft that names the layout counts too, so a template shows up as soon as it is applied.
function pdfLayoutUsers(
  rows: readonly TemplateResourceRow[],
  layoutSlug: string,
  defaultSlug: string,
  policy: ReturnType<typeof deliveryPolicyOf>,
  user: Parameters<typeof draftViewerTenantId>[0],
): PdfLayoutUser[] {
  const groups = new Map<string, TemplateResourceRow[]>();
  for (const row of rows) {
    const key = `${row.slug}\u0000${row.locale}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const users = [...groups.values()].flatMap((group) => {
    const layoutUser = pdfLayoutUserOf(group, layoutSlug, defaultSlug, policy, user);
    return layoutUser === null ? [] : [layoutUser];
  });
  return users.sort((a, b) => a.slug.localeCompare(b.slug) || a.locale.localeCompare(b.locale));
}

export function makeUsageQuery(policy: TemplateEditPolicy) {
  return defineQueryHandler({
    name: "usage",
    schema: z.object({ slug: templateSlugSchema, kind: z.enum(TEMPLATE_KINDS) }),
    access: { roles: ["TenantAdmin", "SystemAdmin"] },
    description:
      "Lists what uses one template: a mail template is used by the notification whose qualified name is its slug and that has a code template, a mail layout by every mail notification whose effective template (own override, else system) names it, or whose code meta does when no stored template exists, or that falls back to the default layout (`usedBy`); a PDF layout is used by every visible PDF template and locale whose served version names it or, naming none, falls back to it through the tenant's default PDF layout (`usedByTemplates` with slug, locale, title, `hasOwnLayout`, `isSystem`, `status` and `version`; a template whose saved draft names the layout is listed too, with status draft); use it to show what a change to a template affects.",
    handler: async (query, ctx) => {
      const { slug, kind } = query.payload;
      if (kind === "pdf-layout") {
        const defaultSlug = await defaultPdfLayoutSlug(ctx, query.user.tenantId);
        const rows = await visibleRowsOfKind(ctx, policy, query.user, "document-pdf");
        return {
          usedBy: [],
          usedByTemplates: pdfLayoutUsers(
            rows,
            slug,
            defaultSlug,
            deliveryPolicyOf(ctx.registry),
            query.user,
          ),
        };
      }
      if (kind !== "mail-layout") return { usedBy: collectTemplateUsage(ctx.registry, slug, kind) };
      const visibleRows = await visibleRowsOfKind(ctx, policy, query.user, "mail");
      return {
        usedBy: collectTemplateUsage(
          ctx.registry,
          slug,
          kind,
          effectiveMailLayoutSlugs(visibleRows, deliveryPolicyOf(ctx.registry)),
        ),
      };
    },
  });
}
