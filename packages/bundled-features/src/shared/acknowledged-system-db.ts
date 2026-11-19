import { requireSystemDb, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { AppContext } from "@cosmicdrift/kumiko-framework/engine";

export { requireSystemDb } from "@cosmicdrift/kumiko-framework/db";

type CrossTenantReason = Parameters<
  NonNullable<AppContext["systemDb"]>["acknowledgeCrossTenant"]
>[0];

export function acknowledgedSystemDb(
  ctx: Pick<AppContext, "systemDb">,
  featureName: string,
  crossTenantReason: CrossTenantReason,
): TenantDb {
  return requireSystemDb(ctx, featureName).acknowledgeCrossTenant(crossTenantReason);
}
