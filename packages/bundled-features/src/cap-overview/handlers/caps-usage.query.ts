import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  crossTenantOverrideDenied,
  defineQueryHandler,
  type QueryHandlerDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { tierAssignmentEntity } from "../../tier-engine/index.js";
import type { CapSpec, CapUsageWithMeta } from "../types.js";
import { computeFraction, computeTone, computeUnclampedFraction } from "../usage-math.js";

type TierAssignmentRow = { readonly tenantId: string; readonly tier: string };

const tierAssignmentTable = buildEntityTable("tier-assignment", tierAssignmentEntity);

export function createCapsUsageQuery(
  caps: readonly CapSpec[],
  usageRoles: readonly string[],
): QueryHandlerDefinition {
  return defineQueryHandler({
    name: "caps:usage",
    description:
      "Returns the calling user's own tenant's configured caps with used amount, tier limit and utilisation fraction; use it to answer how close a tenant is to its quota (only SystemAdmin may target another tenant via tenantId).",
    schema: z.object({ tenantId: z.string().min(1).optional() }),
    access: { roles: usageRoles },
    // COUNT/SUM/AVG are covered by TenantDb.count/TenantDb.aggregate; the grant
    // stays for app-owned CapSpec.usage() providers that still use unsafeRaw.
    escapeHatch: {
      reason:
        "cap-overview:caps:usage — grants app-owned CapSpec.usage() providers that still use unsafeRaw; COUNT/SUM/AVG are covered by TenantDb.count/TenantDb.aggregate",
    },
    handler: async (query, ctx) => {
      if (!ctx.systemDb) {
        throw new InternalError({
          message: "cap-overview:query:caps:usage requires ctx.systemDb — is r.systemScope() set?",
        });
      }
      const override = query.payload.tenantId;
      const overrideDenied = crossTenantOverrideDenied(
        query.user,
        override,
        "cap-overview.errors.tenantOverrideRequiresSystemAdmin",
      );
      if (overrideDenied) throw overrideDenied;

      const targetTenantId = override ?? query.user.tenantId;
      // Both branches return the SAME unfiltered system-mode db —
      // assertTenantMatch is a self-check on the caller, not a query
      // filter (see tenant-db.ts). Every read below carries its own
      // explicit `tenantId` WHERE regardless of which branch ran.
      const db =
        override !== undefined
          ? ctx.systemDb.acknowledgeCrossTenant(
              `cap-overview:caps:usage — SystemAdmin cross-tenant read for tenant ${targetTenantId}`,
            )
          : ctx.systemDb.assertTenantMatch(query.user.tenantId);

      const assignmentRows = await selectMany<TierAssignmentRow>(db, tierAssignmentTable, {
        tenantId: [targetTenantId],
      });
      // Defense-in-depth on the own-tenant path only: assertRowsTenant
      // checks rows against the CALLER's own tenantId, which is only
      // meaningful when the caller is reading their own tenant — on the
      // SystemAdmin override path the target tenant legitimately differs
      // from the caller's own tenantId, so the check would misfire there.
      const checkedRows =
        override === undefined
          ? ctx.systemDb.assertRowsTenant(assignmentRows, "tenantId")
          : assignmentRows;
      const tier = checkedRows[0]?.tier ?? "";

      const rows: CapUsageWithMeta[] = await Promise.all(
        caps.map(async (cap) => {
          const used = await cap.usage(db, targetTenantId);
          const limit = await cap.limit(tier, { config: ctx.config });
          const base = {
            id: cap.id,
            label: cap.label,
            limit,
            ...(cap.icon !== undefined && { icon: cap.icon }),
            ...(cap.accentColor !== undefined && { accentColor: cap.accentColor }),
          };
          if (used === null) {
            return { ...base, used: null, fraction: 0, tone: "default" as const, percent: null };
          }
          const fraction = computeFraction(used, limit);
          return {
            ...base,
            used,
            fraction,
            tone: computeTone(fraction),
            percent:
              limit === null ? null : Math.round(computeUnclampedFraction(used, limit) * 100),
          };
        }),
      );

      return { rows };
    },
  });
}
