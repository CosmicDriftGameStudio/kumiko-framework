import type { DbRunner } from "../../db/connection";
import { type TenantDb, unsafeRawForDeclaredStep } from "../../db/tenant-db";
import type { PipelineCtx } from "../types/step";

// unsafeRaw fails closed without the handler's escapeHatch (or systemScope) and reports the use.
export function readSourceFor(
  ctx: PipelineCtx,
  unsafeAllTenants: { readonly reason: string } | undefined,
): TenantDb | DbRunner {
  if (!unsafeAllTenants) return ctx.db;
  return unsafeRawForDeclaredStep(ctx.systemDb ?? ctx.db, unsafeAllTenants.reason);
}
