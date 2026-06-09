import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import type { TemplateResourceRow } from "../table";
import { templateResourcesTable } from "../table";
import { executor } from "./shared";

type TemplateStatus = "active" | "archived";

function createStatusUpdateHandler(name: string, status: TemplateStatus) {
  return defineWriteHandler({
    name,
    schema: z.object({ id: z.string().min(1) }),
    access: { roles: ["TenantAdmin", "SystemAdmin"] },
    handler: async (event, ctx) => {
      const existing = await fetchOne<TemplateResourceRow>(ctx.db, templateResourcesTable, {
        id: event.payload.id,
      });
      if (!existing) {
        return writeFailure(new NotFoundError("template-resource", event.payload.id));
      }
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

export const archiveWrite = createStatusUpdateHandler("archive", "archived");
export const publishWrite = createStatusUpdateHandler("publish", "active");
