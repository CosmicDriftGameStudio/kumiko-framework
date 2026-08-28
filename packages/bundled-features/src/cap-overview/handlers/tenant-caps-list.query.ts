import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable, decodeCursor, encodeCursor } from "@cosmicdrift/kumiko-framework/db";
import { definePagedQueryHandler, MAX_LIST_LIMIT } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, ValidationError } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { subscriptionsProjectionTable } from "../../billing-foundation";
import { tenantTable } from "../../tenant";
import { tierAssignmentEntity } from "../../tier-engine";
import { capFieldName } from "../constants";
import type { CapSpec, CapUsage } from "../types";
import { computeFraction } from "../usage-math";

type TenantRow = { readonly id: string; readonly name: string };
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
  readonly name: string;
  readonly tier: string;
  readonly billing: string;
  readonly [capField: string]: unknown;
};

// tier-resolver.ts rebuilds the same drizzle table locally rather than
// importing a pre-built one — tier-engine's public barrel only exports the
// entity, not a built table (see tier-engine/tier-resolver.ts).
const tierAssignmentTable = buildEntityTable("tier-assignment", tierAssignmentEntity);

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

const SORTABLE_FIELDS = ["name", "tier", "billing"] as const;
type SortableField = (typeof SORTABLE_FIELDS)[number];

function isSortableField(field: string): field is SortableField {
  return (SORTABLE_FIELDS as readonly string[]).includes(field);
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
    schema: z.object({
      cursor: z.string().optional(),
      limit: z.number().int().min(1).max(MAX_LIST_LIMIT).default(50),
      sort: z.string().optional(),
      sortDirection: z.enum(["asc", "desc"]).optional(),
      search: z.string().optional(),
      filters: z
        .array(z.object({ field: z.string(), op: FILTER_OP, value: z.unknown() }))
        .optional(),
      totalCount: z.boolean().optional(),
    }),
    access: { roles: ["SystemAdmin"] },
    handler: async (query, ctx) => {
      if (!ctx.systemDb) {
        throw new InternalError({
          message:
            "cap-overview:query:tenant-caps:list requires ctx.systemDb — is r.systemScope() set?",
        });
      }
      const db = ctx.systemDb.acknowledgeCrossTenant(
        "cap-overview:tenant-caps:list — SystemAdmin platform-wide tenant overview",
      );

      const tenants = await selectMany<TenantRow>(db, tenantTable, {});
      const assignments = await selectMany<TierAssignmentRow>(db, tierAssignmentTable, {});
      const subscriptions = await selectMany<SubscriptionRow>(db, subscriptionsProjectionTable, {});

      const assignmentByTenant = new Map(assignments.map((row) => [row.tenantId, row]));
      const subscriptionByTenant = new Map(subscriptions.map((row) => [row.tenantId, row]));

      // Case-insensitive substring search has no `ilike` operator in the
      // query builder (only `like`, SQL-LIKE case-sensitive) — filtered here
      // in JS, same as tenant/team-list.query.ts's search.
      const search = query.payload.search?.trim().toLowerCase();
      const filters = query.payload.filters ?? [];
      const tierFilter = filters.find((f) => f.field === "tier");
      if (tierFilter !== undefined) assertSupportedTierFilterOp(tierFilter.op);

      const merged = tenants
        .filter(
          (tenant) =>
            search === undefined || search === "" || tenant.name.toLowerCase().includes(search),
        )
        .map((tenant) => {
          const assignment = assignmentByTenant.get(tenant.id);
          return {
            tenantId: tenant.id,
            name: tenant.name,
            tier: assignment?.tier ?? "",
            source: assignment?.source ?? null,
            billing: billingLabel(subscriptionByTenant.get(tenant.id), assignment?.source ?? null),
          };
        })
        .filter((row) => matchesTierFilter(row.tier, tierFilter));

      const sortField = query.payload.sort ?? "name";
      if (!isSortableField(sortField)) {
        throw new ValidationError({
          fields: [
            {
              path: "sort",
              code: "unsupported_field",
              i18nKey: "cap-overview.errors.sortFieldUnsupported",
              params: { field: sortField },
            },
          ],
        });
      }
      const sortDirection = query.payload.sortDirection ?? "asc";
      const directionMultiplier = sortDirection === "asc" ? 1 : -1;
      const sorted = [...merged].sort(
        (a, b) => a[sortField].localeCompare(b[sortField]) * directionMultiplier,
      );

      // ponytail: base64-wrapped offset, not a SQL keyset — rows come from a
      // JS merge of three tables (tenant/tier-assignment/subscription), same
      // rationale as tenant/team-list.query.ts. Holds up to tier-engine's
      // documented "single-pass scan" scale (a few thousand tenants); past
      // that the fix is a real combined read-projection, not a cursor
      // bolted onto this merge.
      const offset = query.payload.cursor ? Number(decodeCursor(query.payload.cursor)) : 0;
      const limit = query.payload.limit;
      const page = sorted.slice(offset, offset + limit);

      // N+1 avoidance: usage is computed only for this page's tenant ids,
      // never for the full tenant set.
      const pageTenantIds = page.map((row) => row.tenantId);
      const usageByCap = new Map<string, Map<string, number | null>>();
      for (const cap of listedCaps) {
        if (cap.usageBatch) {
          usageByCap.set(cap.id, await cap.usageBatch(db, pageTenantIds));
        } else {
          const perTenant = new Map<string, number | null>();
          for (const tenantId of pageTenantIds) {
            perTenant.set(tenantId, await cap.usage(db, tenantId));
          }
          usageByCap.set(cap.id, perTenant);
        }
      }

      const rows: TenantCapsListRow[] = page.map((row) => {
        const capFields: Record<string, CapUsage> = {};
        for (const cap of listedCaps) {
          // A tenant absent from the map still means 0 (existing behavior);
          // only an explicit `null` value means "not measured".
          const rawUsed = usageByCap.get(cap.id)?.get(row.tenantId);
          const used = rawUsed === undefined ? 0 : rawUsed;
          const limit = cap.limit(row.tier);
          capFields[capFieldName(cap.id)] =
            used === null
              ? { used: null, limit, fraction: 0 }
              : { used, limit, fraction: computeFraction(used, limit) };
        }
        return {
          tenantId: row.tenantId,
          name: row.name,
          tier: row.tier,
          billing: row.billing,
          ...capFields,
        };
      });

      const nextCursor =
        offset + limit < sorted.length ? encodeCursor(String(offset + limit)) : null;

      return {
        rows,
        nextCursor,
        ...(query.payload.totalCount === true && { total: merged.length }),
      };
    },
  });
}
