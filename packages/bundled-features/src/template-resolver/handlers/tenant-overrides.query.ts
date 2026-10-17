import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { TenantQueries } from "../../tenant/index.js";
import { type TemplateResourceRow, templateResourcesTable } from "../table.js";
import { servedVersionOf } from "../template-draft.js";
import { buildOverrideDiff } from "./override-diff.js";
import { kindSchema, localeSchema, templateSlugSchema } from "./shared.js";

const TENANT_OVERRIDES_REASON =
  "SystemAdmin template overview lists which tenants override one system template; it reads tenant-scope template rows of every tenant (and the system row for the optional per-tenant diff), which the tenant-scoped db cannot reach";

const tenantIdsSchema = z.array(z.string());
const directorySchema = z.object({
  rows: z.array(z.object({ id: z.string(), label: z.string() })),
});

type OverrideStatus = "active" | "draft";

function labelsOf(raw: unknown): ReadonlyMap<string, string> {
  return new Map(directorySchema.parse(raw).rows.map((row) => [row.id, row.label]));
}

// One row per tenant: its active override wins over a draft, then the newest version.
function isBetterRow(candidate: TemplateResourceRow, current: TemplateResourceRow): boolean {
  if ((candidate.status === "active") !== (current.status === "active")) {
    return candidate.status === "active";
  }
  return candidate.version > current.version;
}

function statusOf(row: TemplateResourceRow): OverrideStatus {
  return row.status === "active" ? "active" : "draft";
}

function isCountedTenantRow(
  row: TemplateResourceRow,
  enabledTenantIds: ReadonlySet<string> | null,
): boolean {
  if (row.tenantId === SYSTEM_TENANT_ID || row.status === "archived") return false;
  return enabledTenantIds === null || enabledTenantIds.has(row.tenantId);
}

function pickBestRowPerTenant(
  found: readonly TemplateResourceRow[],
  enabledTenantIds: ReadonlySet<string> | null,
): Map<string, TemplateResourceRow> {
  const bestByTenant = new Map<string, TemplateResourceRow>();
  for (const row of found) {
    if (!isCountedTenantRow(row, enabledTenantIds)) continue;
    const current = bestByTenant.get(row.tenantId);
    if (current === undefined || isBetterRow(row, current)) bestByTenant.set(row.tenantId, row);
  }
  return bestByTenant;
}

function toOverrideRow(
  row: TemplateResourceRow,
  tenantLabels: ReadonlyMap<string, string>,
  userLabels: ReadonlyMap<string, string>,
) {
  const changedById = row.modifiedById ?? row.insertedById;
  return {
    tenantId: row.tenantId,
    tenantName: tenantLabels.get(row.tenantId) ?? row.tenantId,
    templateId: String(row.id),
    locale: row.locale,
    status: statusOf(row),
    version: servedVersionOf(row),
    changedAt: (row.modifiedAt ?? row.insertedAt).toString(),
    changedBy: changedById === null ? null : (userLabels.get(changedById) ?? null),
  };
}

export const tenantOverridesQuery = defineQueryHandler({
  name: "tenant-overrides",
  schema: z.object({
    slug: templateSlugSchema,
    kind: kindSchema,
    locale: localeSchema.optional(),
    /** Adds the block diff of this tenant's override against the system template. */
    diffTenantId: z.string().min(1).optional(),
  }),
  access: { roles: ["SystemAdmin"] },
  description:
    "Lists the enabled tenants that override one template with an active or a draft version (tenant name, status, version, last change and who made it), next to the counts and the number of enabled tenants; use it before changing a system template to see who keeps their own copy. With diffTenantId it also returns the block diff of that tenant's override against the system template.",
  escapeHatch: { grants: ["unsafeRaw"], reason: TENANT_OVERRIDES_REASON },
  handler: async (query, ctx) => {
    const { slug, kind, locale, diffTenantId } = query.payload;
    const raw = ctx.db.unsafeRaw();
    const found = await selectMany<TemplateResourceRow>(raw, templateResourcesTable, {
      slug,
      kind,
      scope: "tenant",
      ...(locale === undefined ? {} : { locale }),
    });

    const hasTenantFeature =
      ctx.registry.getQueryHandler(TenantQueries.activeTenantIds) !== undefined;
    const enabledTenantIds = hasTenantFeature
      ? new Set(tenantIdsSchema.parse(await ctx.query(TenantQueries.activeTenantIds, {})))
      : null;

    const bestByTenant = pickBestRowPerTenant(found, enabledTenantIds);
    const best = [...bestByTenant.values()];
    const tenantLabels = hasTenantFeature
      ? labelsOf(await ctx.query(TenantQueries.tenantDirectory, {}))
      : new Map<string, string>();
    const userLabels = hasTenantFeature
      ? labelsOf(await ctx.query(TenantQueries.memberDirectory, {}))
      : new Map<string, string>();

    const rows = best
      .map((row) => toOverrideRow(row, tenantLabels, userLabels))
      .sort((a, b) => a.tenantName.localeCompare(b.tenantName));

    let diff: ReturnType<typeof buildOverrideDiff> | null = null;
    const diffRow = diffTenantId === undefined ? undefined : bestByTenant.get(diffTenantId);
    if (diffRow !== undefined) {
      const [systemRow] = await selectMany<TemplateResourceRow>(raw, templateResourcesTable, {
        tenantId: SYSTEM_TENANT_ID,
        slug,
        kind,
        locale: diffRow.locale,
      });
      if (systemRow !== undefined) diff = buildOverrideDiff(diffRow, systemRow);
    }

    return {
      activeOverrides: best.filter((row) => row.status === "active").length,
      draftOverrides: best.filter((row) => row.status !== "active").length,
      totalTenants: enabledTenantIds === null ? null : enabledTenantIds.size,
      rows,
      diff,
    };
  },
});
