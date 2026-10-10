import type {
  HandlerContext,
  TenantId,
  TenantWriteTarget,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";

// ctx.forTenant is absent for r.systemScope() handlers and without a db; a write handler that
// needs a cross-tenant target must fail loudly instead of falling back to ctx.db.
export function requireForTenant(
  ctx: Pick<HandlerContext, "forTenant">,
  targetTenantId: TenantId,
): TenantWriteTarget {
  if (!ctx.forTenant) {
    throw new InternalError({ message: "ctx.forTenant is not available in this handler context" });
  }
  return ctx.forTenant(targetTenantId);
}
