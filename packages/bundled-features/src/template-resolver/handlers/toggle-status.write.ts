import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineWriteHandler, type Registry } from "@cosmicdrift/kumiko-framework/engine";
import {
  type FieldIssue,
  NotFoundError,
  ValidationError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import type { TemplateResourceRow } from "../table.js";
import { templateResourcesTable } from "../table.js";
import { executor } from "./shared.js";
import { publishGateIssues } from "./template-gates.js";

type TemplateStatus = "active" | "archived";

function createStatusUpdateHandler(
  name: string,
  status: TemplateStatus,
  description: string,
  gate?: (registry: Registry, row: TemplateResourceRow) => readonly FieldIssue[],
) {
  return defineWriteHandler({
    name,
    schema: z.object({ id: z.string().min(1) }),
    access: { roles: ["TenantAdmin", "SystemAdmin"] },
    description,
    handler: async (event, ctx) => {
      // ctx.db is tenant-scoped: a foreign tenant's id reads as absent → NotFound.
      // Cross-tenant toggling needs SystemAdmin with tenantIdOverride.
      const existing = await fetchOne<TemplateResourceRow>(ctx.db, templateResourcesTable, {
        id: event.payload.id,
      });
      if (!existing) {
        return writeFailure(new NotFoundError("template-resource", event.payload.id));
      }
      const issues = gate?.(ctx.registry, existing) ?? [];
      if (issues.length > 0) return writeFailure(new ValidationError({ fields: [...issues] }));
      const result = await executor.update(
        { id: existing.id, version: existing.version, changes: { status } },
        event.user,
        ctx.db,
      );
      if (!result.isSuccess) return result;
      return { isSuccess: true as const, data: { id: String(existing.id), status } };
    },
  });
}

export const archiveWrite = createStatusUpdateHandler(
  "archive",
  "archived",
  "Sets one template resource of the caller's tenant to archived so the resolver stops serving it while the row and its content survive; use it to retire a template reversibly instead of deleting it.",
);
export const publishWrite = createStatusUpdateHandler(
  "publish",
  "active",
  "Sets one template resource of the caller's tenant to active so the resolver starts serving it; use it to release a draft written by upsert-tenant, or to bring an archived template back; a mail template with unknown placeholders or unused required variables is refused.",
  publishGateIssues,
);
