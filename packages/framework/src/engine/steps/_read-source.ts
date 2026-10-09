import type { DbRunner } from "../../db/connection.js";
import type { WhereObject } from "../../db/query.js";
import { type TenantDb, unsafeRawForDeclaredStep } from "../../db/tenant-db.js";
import { InternalError } from "../../errors/classes.js";
import { SYSTEM_TENANT_ID } from "../types/identifiers.js";
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

// TenantDb silently narrows a foreign where.tenantId to the caller's scope; the step keeps that
// behavior but makes the dropped filter visible, since it usually means a cross-tenant read was intended.
export function warnOnNarrowedForeignTenantFilter(
  ctx: PipelineCtx,
  stepKind: string,
  stepName: string,
  where: WhereObject | undefined,
  unsafeAllTenants: { readonly reason: string } | undefined,
): void {
  // skip: explicit cross-tenant read, nothing was narrowed.
  if (unsafeAllTenants) return;
  const requested = where?.["tenantId"];
  // skip: no tenantId filter requested.
  if (requested === undefined) return;
  const allowed: readonly string[] = [ctx.db.tenantId, SYSTEM_TENANT_ID];
  const requestedList = Array.isArray(requested) ? requested : [requested];
  // skip: every requested tenant is within the caller's scope.
  if (requestedList.every((t) => typeof t === "string" && allowed.includes(t))) return;
  ctx.log?.warn(
    `${stepKind} "${stepName}": where.tenantId is outside the caller's tenant scope and was narrowed`,
    {
      step: stepKind,
      name: stepName,
      hint: "pass unsafeAllTenants: { reason } (with an escapeHatch on the handler) to read across tenants",
    },
  );
}
