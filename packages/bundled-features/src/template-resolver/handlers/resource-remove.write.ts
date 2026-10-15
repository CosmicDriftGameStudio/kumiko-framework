import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineWriteHandler, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { requireForTenant } from "../../shared/index.js";
import { type TemplateResourceRow, templateResourcesTable } from "../table.js";
import { parseLinkedResources, resourceKeySchema } from "./resource-shared.js";
import { executor } from "./shared.js";

// The FileRef itself stays: copy-locale and tenant overrides can share ids and there is
// no reference count to tell when the last user is gone.
export const resourceRemoveWrite = defineWriteHandler({
  name: "resource-remove",
  schema: z.object({
    templateId: z.string().min(1),
    key: resourceKeySchema,
    /** Cross-tenant target — SystemAdmin only. */
    tenantIdOverride: z.string().min(1).optional(),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Unlinks an image resource key from a template; removing a key the template does not have succeeds without a change.",
  handler: async (event, ctx) => {
    const { templateId, key } = event.payload;
    // @cast-boundary engine-payload — override is a zod-validated string; forTenant
    // rejects it for non-SystemAdmins.
    const tenantId = (event.payload.tenantIdOverride ?? event.user.tenantId) as TenantId;
    const { db, streamTenantId } = requireForTenant(ctx, tenantId);
    const row = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
      tenantId,
      id: templateId,
    });
    if (row === undefined) return writeFailure(new NotFoundError("template-resource", templateId));

    const { [key]: removed, ...remaining } = parseLinkedResources(row.linkedResources);
    if (removed === undefined) return { isSuccess: true as const, data: { key, removed: false } };

    const updated = await executor.update(
      {
        id: row.id,
        version: row.version,
        changes: { linkedResources: JSON.stringify(remaining) },
      },
      event.user,
      db,
      { streamTenantId },
    );
    if (!updated.isSuccess) return updated;
    return { isSuccess: true as const, data: { key, removed: true } };
  },
});
