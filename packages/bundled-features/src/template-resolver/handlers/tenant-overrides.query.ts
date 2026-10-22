import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  defineQueryHandler,
  MAX_LIST_LIMIT,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { TenantQueries } from "../../tenant/index.ts";
import { type TemplateResourceRow, templateResourcesTable } from "../table.ts";
import { servedVersionOf } from "../template-draft.ts";
import { buildOverrideDiff } from "./override-diff.ts";
import { kindSchema, localeSchema, templateSlugSchema } from "./shared.ts";
import {
  loadEnabledTenantIds,
  pickBestRowPerTenant,
  TENANT_OVERRIDES_REASON,
} from "./tenant-override-selection.ts";

const directorySchema = z.object({
  rows: z.array(z.object({ id: z.string(), label: z.string() })),
});

type OverrideStatus = "active" | "draft";

function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

type DirectoryQueryContext = {
  readonly query: (name: string, payload: { ids: string[] }) => Promise<unknown>;
};

// Looks up only the ids the overrides need, so labels never depend on the directory's default cap.
async function labelsFor(
  ctx: DirectoryQueryContext,
  queryName: string,
  ids: ReadonlySet<string>,
): Promise<ReadonlyMap<string, string>> {
  const labels = new Map<string, string>();
  for (const chunk of chunksOf([...ids], MAX_LIST_LIMIT)) {
    const raw = await ctx.query(queryName, { ids: chunk });
    for (const row of directorySchema.parse(raw).rows) labels.set(row.id, row.label);
  }
  return labels;
}

function changerIdsOf(rows: readonly TemplateResourceRow[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const changedById = row.modifiedById ?? row.insertedById;
    if (changedById !== null) ids.add(changedById);
  }
  return ids;
}

function statusOf(row: TemplateResourceRow): OverrideStatus {
  return row.status === "active" ? "active" : "draft";
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

    const enabledTenantIds = await loadEnabledTenantIds(ctx);
    const hasTenantFeature = enabledTenantIds !== null;

    const bestByTenant = pickBestRowPerTenant(found, enabledTenantIds);
    const best = [...bestByTenant.values()];
    const tenantLabels = hasTenantFeature
      ? await labelsFor(
          ctx,
          TenantQueries.tenantDirectory,
          new Set(best.map((row) => row.tenantId)),
        )
      : new Map<string, string>();
    const userLabels = hasTenantFeature
      ? await labelsFor(ctx, TenantQueries.memberDirectory, changerIdsOf(best))
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
