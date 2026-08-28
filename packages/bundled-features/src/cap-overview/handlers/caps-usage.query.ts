import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { buildEntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  crossTenantOverrideDenied,
  defineQueryHandler,
  type QueryHandlerDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { tierAssignmentEntity } from "../../tier-engine";
import type { CapSpec, CapUsageWithMeta } from "../types";
import { computeFraction, computeTone, computeUnclampedFraction } from "../usage-math";

type TierAssignmentRow = { readonly tenantId: string; readonly tier: string };

const tierAssignmentTable = buildEntityTable("tier-assignment", tierAssignmentEntity);

export function createCapsUsageQuery(caps: readonly CapSpec[]): QueryHandlerDefinition {
  return defineQueryHandler({
    name: "caps:usage",
    schema: z.object({ tenantId: z.string().min(1).optional() }),
    access: { roles: access.admin },
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
          const limit = cap.limit(tier);
          const fraction = computeFraction(used, limit);
          return {
            id: cap.id,
            label: cap.label,
            used,
            limit,
            fraction,
            tone: computeTone(fraction),
            percent: Math.round(computeUnclampedFraction(used, limit) * 100),
          };
        }),
      );

      return { rows };
    },
  });
}
