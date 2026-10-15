import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  defineWriteHandler,
  type Registry,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  type FieldIssue,
  NotFoundError,
  ValidationError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { requireForTenant } from "../../shared/index.js";
import type { TemplateResourceRow } from "../table.js";
import { templateResourcesTable } from "../table.js";
import { executor } from "./shared.js";
import { publishGateIssues } from "./template-gates.js";

type TemplateStatus = "active" | "archived";
type StatusTarget = "own" | "system";

function isRowOfTarget(row: TemplateResourceRow, target: StatusTarget, callerTenantId: string) {
  return target === "system"
    ? row.tenantId === SYSTEM_TENANT_ID && row.scope === "system"
    : row.tenantId === callerTenantId;
}

function createStatusUpdateHandler(
  name: string,
  target: StatusTarget,
  status: TemplateStatus,
  description: string,
  gate?: (registry: Registry, row: TemplateResourceRow) => readonly FieldIssue[],
) {
  return defineWriteHandler({
    name,
    schema: z.object({ id: z.string().min(1) }),
    access: { roles: target === "system" ? ["SystemAdmin"] : ["TenantAdmin", "SystemAdmin"] },
    // A system template change reaches every tenant without an override.
    ...(target === "system" ? { agent: { risk: "high" as const } } : {}),
    description,
    handler: async (event, ctx) => {
      const scoped = target === "system" ? requireForTenant(ctx, SYSTEM_TENANT_ID) : null;
      const db = scoped?.db ?? ctx.db;
      // The tenant db also reads system rows; the row's own tenant must match
      // the target or the executor would append to a foreign event stream.
      const existing = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
        id: event.payload.id,
      });
      if (!existing || !isRowOfTarget(existing, target, event.user.tenantId)) {
        return writeFailure(new NotFoundError("template-resource", event.payload.id));
      }
      const issues = gate?.(ctx.registry, existing) ?? [];
      if (issues.length > 0) return writeFailure(new ValidationError({ fields: [...issues] }));
      const result = await executor.update(
        { id: existing.id, version: existing.version, changes: { status } },
        event.user,
        db,
        scoped ? { streamTenantId: scoped.streamTenantId } : undefined,
      );
      if (!result.isSuccess) return result;
      return { isSuccess: true as const, data: { id: String(existing.id), status } };
    },
  });
}

export const archiveWrite = createStatusUpdateHandler(
  "archive",
  "own",
  "archived",
  "Sets one template resource of the caller's tenant to archived so the resolver stops serving it while the row and its content survive; use it to retire a template reversibly instead of deleting it.",
);
export const publishWrite = createStatusUpdateHandler(
  "publish",
  "own",
  "active",
  "Sets one template resource of the caller's tenant to active so the resolver starts serving it; use it to release a draft written by upsert-tenant, or to bring an archived template back; a mail template with unknown placeholders or unused required variables is refused.",
  publishGateIssues,
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
  "Sets one system-default template to active so the resolver serves it again to every tenant that has no override; SystemAdmin only, a mail template with unknown placeholders or unused required variables is refused.",
  publishGateIssues,
);
