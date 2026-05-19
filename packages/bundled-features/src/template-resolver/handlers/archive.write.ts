import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { TemplateResourceRow } from "../table";
import { templateResourcesTable } from "../table";
import { executor } from "./shared";

// Setzt einen Template-Eintrag auf status='archived'. Resolver liefert
// archivierte Templates nicht zurück — sie bleiben aber als Audit-Trail
// in der DB (kein physisches Delete). Reaktivierung via publish.
export const archiveWrite = defineWriteHandler({
  name: "archive",
  schema: z.object({ id: z.string().min(1) }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  handler: async (event, ctx) => {
    const existing = await fetchOne<TemplateResourceRow>(
      ctx.db,
      templateResourcesTable,
      eq(templateResourcesTable["id"], event.payload.id),
    );
    // ctx.db ist via createTenantDb tenant-scoped — existing ist null wenn
    // das Template einem fremden Tenant gehört (SystemAdmin-Cross-Tenant
    // braucht tenantIdOverride im Schema, M2-Erweiterung).
    if (!existing) {
      return writeFailure(new NotFoundError("template-resource", event.payload.id));
    }

    const result = await executor.update(
      {
        id: existing.id,
        version: existing.version,
        changes: { status: "archived" as const },
      },
      event.user,
      ctx.db,
    );
    if (!result.isSuccess) return result;
    return { isSuccess: true as const, data: { id: String(existing.id), status: "archived" } };
  },
});
