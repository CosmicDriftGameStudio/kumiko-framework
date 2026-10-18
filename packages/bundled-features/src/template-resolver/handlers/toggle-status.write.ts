import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import {
  defineWriteHandler,
  type HandlerContext,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  NotFoundError,
  ValidationError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { requireForTenant } from "../../shared/index.ts";
import type { TemplateResourceRow } from "../table.ts";
import { templateResourcesTable } from "../table.ts";
import { activationChanges, parseTemplateDraft, toWorkingRow } from "../template-draft.ts";
import { executor } from "./shared.ts";
import { publishGateIssues } from "./template-gates.ts";

type TemplateStatus = "active" | "archived";
export type StatusTarget = "own" | "system";

function isRowOfTarget(row: TemplateResourceRow, target: StatusTarget, callerTenantId: string) {
  return target === "system"
    ? row.tenantId === SYSTEM_TENANT_ID && row.scope === "system"
    : row.tenantId === callerTenantId && row.scope === "tenant";
}

export function writeAccessFor(target: StatusTarget) {
  return { roles: target === "system" ? ["SystemAdmin"] : ["TenantAdmin", "SystemAdmin"] };
}

// The tenant db also reads system rows; the row's own tenant must match the
// target or the executor would append to a foreign event stream.
export async function loadTargetRow(
  ctx: HandlerContext,
  target: StatusTarget,
  user: { readonly tenantId: string },
  id: string,
) {
  const scoped = target === "system" ? requireForTenant(ctx, SYSTEM_TENANT_ID) : null;
  const db = scoped?.db ?? ctx.db;
  const row = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, { id });
  return { db, scoped, row: row && isRowOfTarget(row, target, user.tenantId) ? row : null };
}

type StatusPlan =
  | { readonly ok: true; readonly changes: Record<string, unknown> }
  | { readonly ok: false; readonly failure: WriteFailure };

// Publishing promotes an open draft (gated as the version that goes live); a row
// without one is activated as stored. Archiving leaves the draft standing.
function planStatusChange(
  ctx: HandlerContext,
  row: TemplateResourceRow,
  status: TemplateStatus,
): StatusPlan {
  if (status === "archived") return { ok: true, changes: { status } };
  const issues = publishGateIssues(ctx.registry, toWorkingRow(row, row.tenantId));
  if (issues.length > 0) {
    return { ok: false, failure: writeFailure(new ValidationError({ fields: [...issues] })) };
  }
  return { ok: true, changes: { ...parseTemplateDraft(row.draft), ...activationChanges(row) } };
}

function createStatusUpdateHandler(
  name: string,
  target: StatusTarget,
  status: TemplateStatus,
  description: string,
) {
  return defineWriteHandler({
    name,
    schema: z.object({ id: z.string().min(1) }),
    access: writeAccessFor(target),
    // A system template change reaches every tenant without an override.
    ...(target === "system" ? { agent: { risk: "high" as const } } : {}),
    description,
    handler: async (event, ctx) => {
      const { db, scoped, row } = await loadTargetRow(ctx, target, event.user, event.payload.id);
      if (!row) return writeFailure(new NotFoundError("template-resource", event.payload.id));
      const plan = planStatusChange(ctx, row, status);
      if (!plan.ok) return plan.failure;
      const result = await executor.update(
        { id: row.id, version: row.version, changes: plan.changes },
        event.user,
        db,
        scoped ? { streamTenantId: scoped.streamTenantId } : undefined,
      );
      if (!result.isSuccess) return result;
      return { isSuccess: true as const, data: { id: String(row.id), status } };
    },
  });
}

export const archiveWrite = createStatusUpdateHandler(
  "archive",
  "own",
  "archived",
  "Sets one template resource of the caller's tenant to archived so the resolver stops serving it while the row and its content survive; use it to retire a template reversibly instead of deleting it. An open draft stays.",
);
export const publishWrite = createStatusUpdateHandler(
  "publish",
  "own",
  "active",
  "Sets one template resource of the caller's tenant to active so the resolver starts serving it; use it to release a draft written by upsert-tenant (a draft saved beside an active version replaces it), or to bring an archived template back; a version with unknown placeholders or unused required variables is refused and the served version stays.",
);
export const archiveSystemWrite = createStatusUpdateHandler(
  "archive-system",
  "system",
  "archived",
  "Sets one system-default template to archived so the resolver stops serving it to every tenant that has no override; SystemAdmin only, reversible with publish-system.",
);
export const publishSystemWrite = createStatusUpdateHandler(
  "publish-system",
  "system",
  "active",
  "Sets one system-default template to active so the resolver serves it again to every tenant that has no override; an open draft beside the active version replaces it; SystemAdmin only, a version with unknown placeholders or unused required variables is refused.",
);
