import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  type ConfigAccessor,
  definePagedQueryHandler,
  pagedListSchema,
  pageRows,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, ValidationError } from "@cosmicdrift/kumiko-framework/errors";
import type { SearchAdapter } from "@cosmicdrift/kumiko-framework/search";
import * as z from "zod";
import { subscriptionsProjectionTable } from "../../billing-foundation/index.ts";
import { requireSystemDb } from "../../shared/index.ts";
import { decryptTenantNames, tenantTable } from "../../tenant/index.ts";
import { tierAssignmentTable } from "../../tier-engine/index.ts";
import type { CapSpec, CapSpecLimitContext, CapSpecLimitTenant, CapUsage } from "../types.ts";
import { capFieldName } from "../web/constants.ts";
import { computeFraction } from "../web/usage-math.ts";

type TenantKeyRow = { readonly id: string; readonly key: string };
type TenantNameRow = { readonly id: string; readonly name?: string };
type TierAssignmentRow = {
  readonly tenantId: string;
  readonly tier: string;
  readonly source: string | null;
};
type SubscriptionRow = {
  readonly tenantId: string;
  readonly providerName: string;
  readonly status: string;
};

type TenantCapsListRow = {
  readonly tenantId: string;
  readonly key: string;
  readonly name: string;
  readonly tier: string;
  readonly billing: string;
  readonly [capField: string]: unknown;
};

function billingLabel(
  subscription: SubscriptionRow | undefined,
  tierSource: string | null,
): string {
  if (subscription) return `${subscription.providerName} · ${subscription.status}`;
  if (tierSource === "manual") return "manual";
  return "—";
}

const FILTER_OP = z.enum(["eq", "ne", "lt", "gt", "in"]);
type FilterOp = z.infer<typeof FILTER_OP>;

// Tenant names are ciphertext at rest and not sortable, so the list orders by the plaintext tenant key.
const SORTABLE_FIELDS = ["key", "tier", "billing"] as const;
const DEFAULT_SORT_FIELD = "key";

const TENANT_ENTITY_NAME = "tenant";
// Same candidate cap as entity-list searches.
const TENANT_SEARCH_CANDIDATE_CAP = 1000;

async function withDecryptedPageNames<TRow extends { readonly tenantId: string }>(
  db: Parameters<typeof selectMany>[0],
  pageRows: readonly TRow[],
): Promise<(TRow & { readonly name: string })[]> {
  if (pageRows.length === 0) return [];
  const decrypted = await decryptTenantNames(
    await selectMany<TenantNameRow>(
      db,
      tenantTable,
      { id: { in: pageRows.map((row) => row.tenantId) } },
      { fields: ["id", "name"] },
    ),
    "cap-overview:tenant-caps:list",
  );
  const nameById = new Map(decrypted.map((tenant) => [tenant.id, tenant.name ?? ""]));
  return pageRows.map((row) => ({ ...row, name: nameById.get(row.tenantId) ?? "" }));
}

async function findTenantIdsByName(
  searchAdapter: SearchAdapter | undefined,
  searchTerm: string,
): Promise<{ readonly tenantIds: ReadonlySet<string>; readonly truncated: boolean }> {
  if (searchAdapter === undefined) {
    throw new UnprocessableError("search_adapter_not_wired", {
      details: {
        entity: TENANT_ENTITY_NAME,
        hint: "Wire a SearchAdapter to search tenant names; they are ciphertext at rest.",
      },
    });
  }
  // Tenant docs live on SYSTEM_TENANT_ID like the tenant stream.
  const results = await searchAdapter.search(SYSTEM_TENANT_ID, searchTerm, {
    filterType: TENANT_ENTITY_NAME,
    limit: TENANT_SEARCH_CANDIDATE_CAP,
  });
  return {
    tenantIds: new Set(results.map((result) => String(result.entityId))),
    truncated: results.length >= TENANT_SEARCH_CANDIDATE_CAP,
  };
}

function tenantCapKey(tenantId: string, capId: string): string {
  return JSON.stringify([tenantId, capId]);
}

// One config accessor per tenant: limits may read tenant-scoped config keys, so
// a limit shared across tenants of the same tier would show the wrong value.
async function resolveLimitsByTenantAndCap(
  caps: readonly CapSpec[],
  tenants: readonly { readonly tenantId: TenantId; readonly tier: string }[],
  configFor: ((tenantId: TenantId) => ConfigAccessor) | undefined,
  db: CapSpecLimitContext["db"],
): Promise<ReadonlyMap<string, number | null>> {
  const limitTenants: readonly CapSpecLimitTenant[] = tenants.map(({ tenantId, tier }) => ({
    config: configFor?.(tenantId),
    tenantId,
    tier,
  }));
  const entries = await Promise.all(
    caps.map(async (cap) => {
      if (cap.limitBatch) {
        const batch = await cap.limitBatch(limitTenants, db);
        return limitTenants.map(
          ({ tenantId }) => [tenantCapKey(tenantId, cap.id), batch.get(tenantId) ?? null] as const,
        );
      }
      return Promise.all(
        limitTenants.map(async ({ tier, ...tenantContext }) => {
          const context: CapSpecLimitContext = { ...tenantContext, db };
          return [
            tenantCapKey(tenantContext.tenantId, cap.id),
            await cap.limit(tier, context),
          ] as const;
        }),
      );
    }),
  );
  return new Map(entries.flat());
}

// tier is a plain string with no defined ordering — lt/gt have no meaning
// on it and are rejected rather than silently treated as "no filter".
function assertSupportedTierFilterOp(op: FilterOp): void {
  if (op === "lt" || op === "gt") {
    throw new ValidationError({
      fields: [
        {
          path: "filters",
          code: "unsupported_op",
          i18nKey: "cap-overview.errors.tierFilterOpUnsupported",
          params: { op },
        },
      ],
    });
  }
}

type TierFilterInput = { readonly field: string; readonly op: FilterOp; readonly value: unknown };

function extractTierFilter(filters: readonly TierFilterInput[]): TierFilterInput | undefined {
  const tierFilters = filters.filter((f) => f.field === "tier");
  if (tierFilters.length !== filters.length || tierFilters.length > 1) {
    const unsupportedField = filters.find((f) => f.field !== "tier")?.field ?? "tier";
    throw new ValidationError({
      fields: [
        {
          path: "filters",
          code: "unsupported_field",
          i18nKey: "cap-overview.errors.filterFieldUnsupported",
          params: { field: unsupportedField },
        },
      ],
    });
  }
  const tierFilter = tierFilters[0];
  if (tierFilter !== undefined) assertSupportedTierFilterOp(tierFilter.op);
  return tierFilter;
}

function matchesTierFilter(
  tier: string,
  filter: { readonly op: FilterOp; readonly value: unknown } | undefined,
): boolean {
  if (filter === undefined) return true;
  switch (filter.op) {
    case "eq":
      return tier === filter.value;
    case "ne":
      return tier !== filter.value;
    case "in":
      return Array.isArray(filter.value) && filter.value.includes(tier);
    case "lt":
    case "gt":
      // unreachable in practice — assertSupportedTierFilterOp rejects these before this runs
      return true;
  }
}

export function createTenantCapsListQuery(caps: readonly CapSpec[], listCaps: readonly string[]) {
  const listedCaps = caps.filter((cap) => listCaps.includes(cap.id));

  return definePagedQueryHandler({
    name: "tenant-caps:list",
    description:
      "Lists every tenant on the platform with its key, tier, billing provider/status and per-cap usage, paged and sorted by tenant key unless asked otherwise, searchable by name through the search index and filterable by tier; use it as the operator-wide capacity overview.",
    schema: pagedListSchema(SORTABLE_FIELDS).extend({
      filters: z
        .array(z.object({ field: z.string(), op: FILTER_OP, value: z.unknown() }))
        .optional(),
    }),
    access: { roles: ["SystemAdmin"] },
    escapeHatch: {
      reason:
        "cap-overview:tenant-caps:list — grants app-owned CapSpec.usage()/usageBatch() providers raw SQL for aggregates TenantDb has no typed helper for (e.g. a SUM)",
      grants: ["unsafeRaw"],
    },
    handler: async (query, ctx) => {
      const systemDb = requireSystemDb(ctx, "cap-overview:query:tenant-caps:list");
      const db = systemDb.acknowledgeCrossTenant(
        "cap-overview:tenant-caps:list — SystemAdmin platform-wide tenant overview",
      );

      const { search, ...pageRequest } = query.payload;
      const searchTerm = search?.trim() ?? "";
      const nameMatches =
        searchTerm === ""
          ? undefined
          : await findTenantIdsByName(ctx.services.searchAdapter, searchTerm);

      // Destroyed tenants are left out: their names decrypt to the erased sentinel.
      const tenants = await selectMany<TenantKeyRow>(
        db,
        tenantTable,
        { destroyedAt: null },
        { fields: ["id", "key"] },
      );
      const assignments = await selectMany<TierAssignmentRow>(db, tierAssignmentTable, {});
      const subscriptions = await selectMany<SubscriptionRow>(db, subscriptionsProjectionTable, {});

      const assignmentByTenant = new Map(assignments.map((row) => [row.tenantId, row]));
      const subscriptionByTenant = new Map(subscriptions.map((row) => [row.tenantId, row]));

      const tierFilter = extractTierFilter(query.payload.filters ?? []);

      const merged = tenants
        .filter((tenant) => nameMatches === undefined || nameMatches.tenantIds.has(tenant.id))
        .map((tenant) => {
          const assignment = assignmentByTenant.get(tenant.id);
          return {
            id: tenant.id,
            tenantId: tenant.id,
            key: tenant.key,
            tier: assignment?.tier ?? "",
            billing: billingLabel(subscriptionByTenant.get(tenant.id), assignment?.source ?? null),
          };
        })
        .filter((row) => matchesTierFilter(row.tier, tierFilter));

      // Sort and paging run in memory over plaintext rows of three tables (tenant key, tier
      // assignment, subscription); names are ciphertext, so only the returned page is decrypted.
      const { rows: pageWithoutNames, total } = pageRows(merged, pageRequest, {
        searchFields: [],
        defaultSort: DEFAULT_SORT_FIELD,
      });
      const page = await withDecryptedPageNames(db, pageWithoutNames);

      // Usage is computed only for this page's tenant ids, never for the
      // full tenant set; caps without usageBatch still cost one query per
      // tenant of the page, so those run in parallel.
      const pageTenantIds = page.map((row) => row.tenantId);
      const usageByCap = new Map<string, Map<string, number | null>>();
      await Promise.all(
        listedCaps.map(async (cap) => {
          if (cap.usageBatch) {
            usageByCap.set(cap.id, await cap.usageBatch(db, pageTenantIds));
            // skip: batch result already stored, no per-tenant fallback needed
            return;
          }
          const perTenantEntries = await Promise.all(
            pageTenantIds.map(
              async (tenantId) => [tenantId, await cap.usage(db, tenantId)] as const,
            ),
          );
          usageByCap.set(cap.id, new Map(perTenantEntries));
        }),
      );

      const limitByTenantAndCap = await resolveLimitsByTenantAndCap(
        listedCaps,
        page,
        ctx.tenants.config,
        db,
      );

      const rows: TenantCapsListRow[] = page.map((row) => {
        const capFields: Record<string, CapUsage> = {};
        for (const cap of listedCaps) {
          // A tenant absent from the map still means 0 (existing behavior);
          // only an explicit `null` value means "not measured".
          const rawUsed = usageByCap.get(cap.id)?.get(row.tenantId);
          const used = rawUsed === undefined ? 0 : rawUsed;
          const limit = limitByTenantAndCap.get(tenantCapKey(row.tenantId, cap.id)) ?? null;
          const unit = cap.unit !== undefined ? { unit: cap.unit } : {};
          capFields[capFieldName(cap.id)] =
            used === null
              ? { used: null, limit, fraction: 0, ...unit }
              : { used, limit, fraction: computeFraction(used, limit), ...unit };
        }
        return {
          tenantId: row.tenantId,
          key: row.key,
          name: row.name,
          tier: row.tier,
          billing: row.billing,
          ...capFields,
        };
      });

      return {
        rows,
        nextCursor: null,
        ...(total !== undefined && { total }),
        ...(nameMatches?.truncated === true && { searchTruncated: true as const }),
      };
    },
  });
}
