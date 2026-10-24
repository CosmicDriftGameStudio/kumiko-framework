import type {
  HandlerContext,
  TenantId,
  TenantWriteTarget,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";

// ctx.tenants.writeTarget is absent for r.systemScope() handlers and without a db; a write handler that
// needs a cross-tenant target must fail loudly instead of falling back to ctx.db.
export function requireForTenant(
  ctx: Pick<HandlerContext, "tenants">,
  targetTenantId: TenantId,
): TenantWriteTarget {
  if (!ctx.tenants.writeTarget) {
    throw new InternalError({
      message: "ctx.tenants.writeTarget is not available in this handler context",
    });
  }
  return ctx.tenants.writeTarget(targetTenantId);
}
