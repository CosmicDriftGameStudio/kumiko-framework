import type { DbRunner } from "../../db/connection.js";
import { type TenantDb, unsafeRawForDeclaredStep } from "../../db/tenant-db.js";
import { InternalError } from "../../errors/classes.js";
import type { PipelineCtx } from "../types/step.js";

// unsafeRaw fails closed without the handler's escapeHatch (or systemScope) and reports the use.
export function readSourceFor(
  ctx: PipelineCtx,
  unsafeAllTenants: { readonly reason: string } | undefined,
): TenantDb | DbRunner {
  if (!unsafeAllTenants) return ctx.db;
  // Step args come from untyped call sites too; a boolean `true` (the shape other
  // framework APIs use) must fail as a framework error, not a TypeError on `.reason`.
  if (typeof unsafeAllTenants !== "object" || typeof unsafeAllTenants.reason !== "string") {
    throw new InternalError({
      message: "unsafeAllTenants on a read step must be { reason: string }",
    });
  }
  return unsafeRawForDeclaredStep(ctx.systemDb ?? ctx.db, unsafeAllTenants.reason);
}
