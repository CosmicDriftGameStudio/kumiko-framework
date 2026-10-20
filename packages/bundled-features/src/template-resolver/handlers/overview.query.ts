import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { type TemplateResourceRow, templateResourcesTable } from "../table.ts";
import {
  deliveryPolicyOf,
  isTenantOverrideServed,
  type TemplateDeliveryPolicy,
} from "../template-delivery-policy.ts";
import {
  activeSinceOf,
  activeVersionOf,
  draftViewerTenantId,
  isHiddenSystemDraft,
  parseTemplateDraft,
  servedVersionOf,
} from "../template-draft.ts";
import { mayEditTemplate, type TemplateEditPolicy } from "../template-edit-policy.ts";
import { isSystemOnlyTemplateHiddenFrom } from "../template-system-only.ts";
import { collectTemplateUsage, type EffectiveMailLayoutSlugs } from "../template-usage.ts";
import {
  DEFAULT_MAIL_LAYOUT_SLUG,
  FALLBACK_LOCALE,
  type TemplateStatus,
} from "../web/constants.ts";
import { storedRecord } from "./template-gates.ts";

const OVERVIEW_KINDS = ["mail", "document-pdf", "mail-layout", "pdf-layout"] as const;
type OverviewKind = (typeof OVERVIEW_KINDS)[number];

const OVERVIEW_ROW_LIMIT = 5000;
const LOCKED_OVERRIDE_I18N_KEY = "templateResolver.overview.lockedOverride";

export type OverviewOrigin = "tenant" | "system";
export type OverviewKindGroup = "mail" | "pdf" | "layout";

export type OverviewUsage = {
  readonly qualifiedName: string;
  readonly feature: string;
  readonly notification: string;
  readonly trigger: string | null;
};

export type OverviewRow = {
  readonly id: string;
  readonly slug: string;
  readonly kind: OverviewKind;
  readonly kindGroup: OverviewKindGroup;
  readonly title: string;
  readonly origin: OverviewOrigin;
  readonly locales: readonly string[];
  readonly status: TemplateStatus;
  readonly version: number;
  readonly draftVersion: number | null;
  readonly activeSince: string | null;
  readonly systemVersion: number | null;
  readonly layoutSlug: string | null;
  /** SystemAdmin only: a tenant override is stored but not delivered because the template is not unlocked for tenants. */
  readonly lockedOverride: boolean;
  readonly lockedOverrideI18nKey: string | null;
  /** Tenant row a reset acts on (resetToSystem takes a row id, the overview row is a slug group); set only while a system version exists to fall back to. */
  readonly lockedOverrideId: string | null;
  /** False when a locked override has no system version to fall back to, so a reset would be refused. */
  readonly canResetLockedOverride: boolean;
  readonly modifiedAt: string;
  readonly usedBy: readonly OverviewUsage[];
  readonly usedByCount: number;
};

export type OverviewResponse = {
  readonly rows: readonly OverviewRow[];
  readonly nextCursor: null;
  readonly total: number;
  /** True when the tenant has more template rows than the overview reads; rows and total are then incomplete. */
  readonly truncated: boolean;
};

const SORT_FIELDS = ["title", "slug", "kind", "origin", "status", "modifiedAt"] as const;
type SortField = (typeof SORT_FIELDS)[number];

const KIND_GROUP: Readonly<Record<OverviewKind, OverviewKindGroup>> = {
  mail: "mail",
  "document-pdf": "pdf",
  "mail-layout": "layout",
  "pdf-layout": "layout",
};

function isOverviewKind(kind: string): kind is OverviewKind {
  return OVERVIEW_KINDS.some((candidate) => candidate === kind);
}

function isTemplateStatus(status: string): status is TemplateStatus {
  return status === "draft" || status === "active" || status === "archived";
}

function layoutSlugOf(row: TemplateResourceRow): string {
  const layoutSlug = storedRecord(row.meta)["layoutSlug"];
  return typeof layoutSlug === "string" ? layoutSlug : DEFAULT_MAIL_LAYOUT_SLUG;
}

function preferredRow(rows: readonly TemplateResourceRow[]): TemplateResourceRow | undefined {
  return (
    rows.find((row) => row.locale === FALLBACK_LOCALE) ??
    [...rows].sort((a, b) => a.locale.localeCompare(b.locale))[0]
  );
}

type EffectiveRows = {
  readonly origin: OverviewOrigin;
  readonly rows: TemplateResourceRow[];
  readonly lockedOverride: boolean;
  readonly lockedOverrideId: string | null;
};

// A tenant row of a template that is not unlocked is not delivered, so the system version is the effective one.
function effectiveRowsOf(
  rows: readonly TemplateResourceRow[],
  policy: TemplateDeliveryPolicy,
): EffectiveRows | null {
  const tenantRows = rows.filter((row) => row.scope === "tenant");
  const systemRows = rows.filter((row) => row.scope === "system");
  const live = (list: TemplateResourceRow[]) => list.filter((row) => row.status !== "archived");
  const liveTenant = live(tenantRows);
  const tenantServed = tenantRows.every((row) => isTenantOverrideServed(policy, row));
  if (!tenantServed && liveTenant.length > 0) {
    const liveSystem = live(systemRows);
    if (systemRows.length === 0)
      return { origin: "tenant", rows: liveTenant, lockedOverride: true, lockedOverrideId: null };
    const lockedRow = preferredRow(liveTenant);
    return {
      origin: "system",
      rows: liveSystem.length > 0 ? liveSystem : systemRows,
      lockedOverride: true,
      lockedOverrideId: lockedRow === undefined ? null : String(lockedRow.id),
    };
  }
  if (liveTenant.length > 0)
    return { origin: "tenant", rows: liveTenant, lockedOverride: false, lockedOverrideId: null };
  if (systemRows.length > 0) {
    const liveSystem = live(systemRows);
    return {
      origin: "system",
      rows: liveSystem.length > 0 ? liveSystem : systemRows,
      lockedOverride: false,
      lockedOverrideId: null,
    };
  }
  return tenantRows.length > 0
    ? { origin: "tenant", rows: tenantRows, lockedOverride: false, lockedOverrideId: null }
    : null;
}

export function effectiveMailLayoutSlugs(
  rows: readonly TemplateResourceRow[],
  policy: TemplateDeliveryPolicy,
): EffectiveMailLayoutSlugs {
  const byLocale = new Map<string, TemplateResourceRow[]>();
  for (const row of rows) {
    if (row.kind !== "mail") continue;
    const key = `${row.slug}\u0000${row.locale}`;
    byLocale.set(key, [...(byLocale.get(key) ?? []), row]);
  }
  const bySlug = new Map<string, Map<string, string>>();
  for (const group of byLocale.values()) {
    const effectiveRows = effectiveRowsOf(group, policy);
    // A locked tenant row without a system row is not delivered, so it names no layout.
    if (effectiveRows?.lockedOverride && effectiveRows.origin === "tenant") continue;
    const effective = effectiveRows?.rows[0];
    // All-archived: the renderer falls back to the code-registered template.
    if (effective === undefined || effective.status === "archived") continue;
    const locales = bySlug.get(effective.slug) ?? new Map<string, string>();
    locales.set(effective.locale, layoutSlugOf(effective));
    bySlug.set(effective.slug, locales);
  }
  return bySlug;
}

function modifiedAtOf(row: TemplateResourceRow): string {
  return (row.modifiedAt ?? row.insertedAt).toString();
}

function splitDocumentSlug(slug: string): { feature: string; notification: string } {
  const separator = slug.indexOf(":");
  return separator === -1
    ? { feature: "", notification: slug }
    : { feature: slug.slice(0, separator), notification: slug.slice(separator + 1) };
}

function compareBy(field: SortField, a: OverviewRow, b: OverviewRow): number {
  return String(a[field]).localeCompare(String(b[field]));
}

function isSortField(value: string): value is SortField {
  return SORT_FIELDS.some((candidate) => candidate === value);
}

type OverviewDraft = Omit<OverviewRow, "usedBy" | "usedByCount">;
type OverviewFilter = {
  readonly field: "kindGroup" | "kind" | "origin" | "status";
  readonly value: readonly string[];
};

function groupBySlugAndKind(
  rows: readonly TemplateResourceRow[],
): Map<string, TemplateResourceRow[]> {
  const groups = new Map<string, TemplateResourceRow[]>();
  for (const row of rows) {
    if (!isOverviewKind(row.kind)) continue;
    const key = `${row.kind}|${row.slug}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

// Another tenant's draft, including a system draft seen by a tenant, is never announced.
function draftVersionFor(
  user: { readonly tenantId: string; readonly roles: readonly string[] },
  row: TemplateResourceRow,
): number | null {
  const isOwnRow = row.tenantId === draftViewerTenantId(user, row);
  return isOwnRow && parseTemplateDraft(row.draft) !== null ? row.version : null;
}

// Version columns of one overview row: the served version, a waiting draft and the system version it overrides.
function versionFieldsOf(
  user: { readonly tenantId: string; readonly roles: readonly string[] },
  preferred: TemplateResourceRow,
  groupRows: readonly TemplateResourceRow[],
): Pick<OverviewDraft, "version" | "draftVersion" | "activeSince" | "systemVersion"> {
  const isActive = preferred.status === "active";
  const systemSameLocale = groupRows.find(
    (row) => row.scope === "system" && row.locale === preferred.locale,
  );
  return {
    version: servedVersionOf(preferred),
    draftVersion: draftVersionFor(user, preferred),
    activeSince: isActive ? activeSinceOf(preferred).toString() : null,
    systemVersion: systemSameLocale === undefined ? null : activeVersionOf(systemSameLocale),
  };
}

function buildDrafts(
  groups: ReadonlyMap<string, readonly TemplateResourceRow[]>,
  user: { readonly tenantId: string; readonly roles: readonly string[] },
  policy: TemplateDeliveryPolicy,
): {
  readonly drafts: OverviewDraft[];
  readonly layoutSlugByDocument: Map<string, string>;
} {
  const layoutSlugByDocument = new Map<string, string>();
  const drafts: OverviewDraft[] = [];
  for (const [id, groupRows] of groups) {
    const effective = effectiveRowsOf(groupRows, policy);
    const preferred = effective === null ? undefined : preferredRow(effective.rows);
    if (effective === null || preferred === undefined) continue;
    if (!isOverviewKind(preferred.kind) || !isTemplateStatus(preferred.status)) continue;
    const isDocument = preferred.kind === "mail" || preferred.kind === "document-pdf";
    const layoutSlug = isDocument ? layoutSlugOf(preferred) : null;
    if (layoutSlug !== null && preferred.kind === "document-pdf") {
      layoutSlugByDocument.set(preferred.slug, layoutSlug);
    }
    drafts.push({
      id,
      slug: preferred.slug,
      kind: preferred.kind,
      kindGroup: KIND_GROUP[preferred.kind],
      title: preferred.title ?? preferred.slug,
      origin: effective.origin,
      locales: [...new Set(effective.rows.map((row) => row.locale))].sort(),
      status: preferred.status,
      ...versionFieldsOf(user, preferred, groupRows),
      layoutSlug,
      lockedOverride: effective.lockedOverride,
      lockedOverrideI18nKey: effective.lockedOverride ? LOCKED_OVERRIDE_I18N_KEY : null,
      lockedOverrideId: effective.lockedOverrideId,
      canResetLockedOverride: effective.lockedOverrideId !== null,
      modifiedAt: modifiedAtOf(preferred),
    });
  }
  return { drafts, layoutSlugByDocument };
}

function withUsage(
  draft: OverviewDraft,
  layoutSlugByDocument: ReadonlyMap<string, string>,
  registry: Parameters<typeof collectTemplateUsage>[0],
  effectiveLayouts: EffectiveMailLayoutSlugs,
): OverviewRow {
  let usedBy: OverviewUsage[] = [];
  if (draft.kind === "mail" || draft.kind === "mail-layout") {
    usedBy = collectTemplateUsage(registry, draft.slug, draft.kind, effectiveLayouts).map(
      (entry) => ({
        qualifiedName: entry.qualifiedName,
        feature: entry.feature,
        notification: entry.notification,
        trigger: entry.trigger,
      }),
    );
  } else if (draft.kind === "pdf-layout") {
    usedBy = [...layoutSlugByDocument]
      .filter(([, layoutSlug]) => layoutSlug === draft.slug)
      .map(([documentSlug]) => ({
        qualifiedName: documentSlug,
        ...splitDocumentSlug(documentSlug),
        trigger: null,
      }));
  }
  return { ...draft, usedBy, usedByCount: usedBy.length };
}

function filterRows(
  rows: readonly OverviewRow[],
  search: string | undefined,
  filters: readonly OverviewFilter[],
  layoutSlug: string | undefined,
): OverviewRow[] {
  const needle = search?.trim().toLowerCase() ?? "";
  return rows.filter((row) => {
    if (layoutSlug !== undefined && row.layoutSlug !== layoutSlug) return false;
    if (needle !== "" && !`${row.title} ${row.slug}`.toLowerCase().includes(needle)) return false;
    return filters.every((filter) => filter.value.includes(String(row[filter.field])));
  });
}

const filterSchema = z.object({
  field: z.enum(["kindGroup", "kind", "origin", "status"]),
  op: z.literal("in"),
  value: z.array(z.string()),
});

export function makeOverviewQuery(policy: TemplateEditPolicy) {
  return defineQueryHandler({
    name: "overview",
    schema: z.object({
      search: z.string().optional(),
      filters: z.array(filterSchema).optional(),
      layoutSlug: z.string().optional(),
      sort: z.string().optional(),
      sortDirection: z.enum(["asc", "desc"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).optional(),
      totalCount: z.boolean().optional(),
    }),
    access: { roles: ["TenantAdmin", "SystemAdmin"] },
    description:
      "Lists mail, PDF and layout templates as one row per slug and kind for the caller's tenant (optionally only the mails and PDFs using one layout slug): where the effective version comes from (own override or system), its locales, status and version (the served one; `draftVersion` is set when an unpublished draft waits beside it, `activeSince` says since when the served version applies), the system version it overrides, the layout it uses and which notifications or templates use it; templates of notifications registered with `systemOnly` are listed for SystemAdmins only, and a TenantAdmin sees only the templates the app lists in tenantEditable; a tenant override of a template that is not listed is not delivered, so the row shows the system version with `lockedOverride` true (SystemAdmin only); use it to browse and filter all templates at a glance.",
    handler: async (query, ctx) => {
      const payload = query.payload;
      const fetchedRows = await selectMany<TemplateResourceRow>(
        ctx.db,
        templateResourcesTable,
        { kind: { in: [...OVERVIEW_KINDS] } },
        { orderBy: { col: "id", direction: "asc" }, limit: OVERVIEW_ROW_LIMIT + 1 },
      );
      const truncated = fetchedRows.length > OVERVIEW_ROW_LIMIT;
      const rows = truncated ? fetchedRows.slice(0, OVERVIEW_ROW_LIMIT) : fetchedRows;
      if (truncated) {
        ctx.log?.warn("template overview: row limit reached, result is incomplete", {
          limit: OVERVIEW_ROW_LIMIT,
        });
      }

      const visibleRows = rows.filter(
        (row) =>
          !isHiddenSystemDraft(query.user, row) &&
          !isSystemOnlyTemplateHiddenFrom(query.user, ctx.registry, row) &&
          mayEditTemplate(policy, query.user, row),
      );
      const deliveryPolicy = deliveryPolicyOf(ctx.registry);
      const { drafts, layoutSlugByDocument } = buildDrafts(
        groupBySlugAndKind(visibleRows),
        query.user,
        deliveryPolicy,
      );
      const effectiveLayouts = effectiveMailLayoutSlugs(visibleRows, deliveryPolicy);
      const overviewRows = drafts.map((draft) =>
        withUsage(draft, layoutSlugByDocument, ctx.registry, effectiveLayouts),
      );
      const filtered = filterRows(
        overviewRows,
        payload.search,
        payload.filters ?? [],
        payload.layoutSlug,
      );

      const sortField: SortField =
        payload.sort !== undefined && isSortField(payload.sort) ? payload.sort : "modifiedAt";
      const direction = (payload.sortDirection ?? "desc") === "desc" ? -1 : 1;
      filtered.sort((a, b) => direction * compareBy(sortField, a, b) || a.id.localeCompare(b.id));

      const offset = payload.offset ?? 0;
      return {
        rows: filtered.slice(offset, offset + payload.limit),
        nextCursor: null,
        total: filtered.length,
        truncated,
      } satisfies OverviewResponse;
    },
  });
}
