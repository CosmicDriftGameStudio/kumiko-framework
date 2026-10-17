import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, ValidationError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import type { TemplateResourceRow } from "../table.js";
import { templateResourcesTable } from "../table.js";
import { executor } from "./shared.js";

export const resetToSystemWrite = defineWriteHandler({
  name: "reset-to-system",
  schema: z.object({ id: z.string().min(1) }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Retires a tenant override by archiving it so the resolver serves the active system template again; the override and its content survive and can be published again. Refused when there is no active system template to fall back to.",
  handler: async (event, ctx) => {
    const existing = await fetchOne<TemplateResourceRow>(ctx.db, templateResourcesTable, {
      id: event.payload.id,
    });
    if (!existing || existing.tenantId !== event.user.tenantId || existing.scope !== "tenant") {
      return writeFailure(new NotFoundError("template-resource", event.payload.id));
    }
    const systemRow = await fetchOne<TemplateResourceRow>(ctx.db, templateResourcesTable, {
      tenantId: SYSTEM_TENANT_ID,
      slug: existing.slug,
      kind: existing.kind,
      locale: existing.locale,
      status: "active",
    });
    if (!systemRow) {
      return writeFailure(
        new ValidationError({
          fields: [
            {
              path: "id",
              code: "no_system_template",
              i18nKey: "templateResolver.errors.noSystemTemplate",
            },
          ],
        }),
      );
    }
    const response = {
      isSuccess: true as const,
      data: {
        id: String(existing.id),
        status: "archived" as const,
        systemTemplateId: String(systemRow.id),
      },
    };
    if (existing.status === "archived") return response;
    const result = await executor.update(
      { id: existing.id, version: existing.version, changes: { status: "archived" } },
      event.user,
      ctx.db,
    );
    return result.isSuccess ? response : result;
  },
});
