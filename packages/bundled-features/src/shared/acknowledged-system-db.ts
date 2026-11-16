import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { AppContext } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";

type CrossTenantReason = Parameters<
  NonNullable<AppContext["systemDb"]>["acknowledgeCrossTenant"]
>[0];

export function requireSystemDb(
  ctx: Pick<AppContext, "systemDb">,
  callerName: string,
): NonNullable<AppContext["systemDb"]> {
  if (!ctx.systemDb) {
    throw new InternalError({
      message: `${callerName} requires ctx.systemDb — is r.systemScope() set on the feature?`,
    });
  }
  return ctx.systemDb;
}

export function acknowledgedSystemDb(
  ctx: Pick<AppContext, "systemDb">,
  featureName: string,
  crossTenantReason: CrossTenantReason,
): TenantDb {
  return requireSystemDb(ctx, featureName).acknowledgeCrossTenant(crossTenantReason);
}
