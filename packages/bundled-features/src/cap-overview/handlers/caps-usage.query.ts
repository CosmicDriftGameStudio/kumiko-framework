import { scopeTenantDbToTenant, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  defineQueryHandler,
  mayOverrideTenant,
  type QueryHandlerDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError, FrameworkReasons } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { tierAssignmentTable } from "../../tier-engine/index.ts";
import type { CapSpec, CapUsageWithMeta } from "../types.ts";
import { computeFraction, computeTone, computeUnclampedFraction } from "../web/usage-math.ts";

type TierAssignmentRow = { readonly tenantId: string; readonly tier: string };

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
    systemScope: true,
    handler: async (query, ctx) => {
      const { systemDb } = ctx;
      const override = query.payload.tenantId;
      if (override !== undefined && !mayOverrideTenant(query.user)) {
        throw new AccessDeniedError({
          i18nKey: "cap-overview.errors.tenantOverrideRequiresSystemAdmin",
          details: { reason: FrameworkReasons.tenantOverrideRequiresSystemAdmin },
        });
      }

      const targetTenantId = override ?? query.user.tenantId;
      const targetTenantSystemDb =
        override !== undefined
          ? systemDb.acknowledgeCrossTenant(
              `cap-overview:caps:usage — SystemAdmin cross-tenant read for tenant ${targetTenantId}`,
            )
          : systemDb.assertTenantMatch(query.user.tenantId);
      // App-owned usage() and limit() callbacks see only the target tenant's rows, even without their own tenantId filter.
      const db = scopeTenantDbToTenant(targetTenantSystemDb, targetTenantId);

      const assignmentRows = await selectMany<TierAssignmentRow>(db, tierAssignmentTable, {
        tenantId: [targetTenantId],
      });
      const tier = assignmentRows[0]?.tier ?? "";

      // Override path: limits must read the TARGET tenant's config, not the
      // SystemAdmin caller's.
      const config = override === undefined ? ctx.config : ctx.tenants.config?.(targetTenantId);

      const rows: CapUsageWithMeta[] = await Promise.all(
        caps.map(async (cap) => {
          const used = await cap.usage(db, targetTenantId);
          const limit =
            cap.showLimit === false
              ? null
              : await cap.limit(tier, { config, tenantId: targetTenantId, db });
          const base = {
            id: cap.id,
            label: cap.label,
            limit,
            ...(cap.unit !== undefined && { unit: cap.unit }),
            ...(cap.icon !== undefined && { icon: cap.icon }),
            ...(cap.accentColor !== undefined && { accentColor: cap.accentColor }),
          };
          if (used === null || cap.showLimit === false) {
            return { ...base, used, fraction: 0, tone: "default" as const, percent: null };
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
