import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { requireForTenant } from "../../shared/index.ts";
import { parseLinkedResourceEntries } from "../linked-resources.ts";
import { type TemplateResourceRow, templateResourcesTable } from "../table.ts";
import { resourceKeySchema, resourceTargetTenantId } from "./resource-shared.ts";
import { executor } from "./shared.ts";

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
    "Unlinks a resource key from a template, whether it holds an image, an attached file or a linked PDF template; removing a key the template does not have succeeds without a change.",
  handler: async (event, ctx) => {
    const { templateId, key } = event.payload;
    const tenantId = resourceTargetTenantId(event.payload.tenantIdOverride, event.user.tenantId);
    const { db, streamTenantId } = requireForTenant(ctx, tenantId);
    const row = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
      tenantId,
      id: templateId,
    });
    if (row === undefined) return writeFailure(new NotFoundError("template-resource", templateId));

    const { [key]: removed, ...remaining } = parseLinkedResourceEntries(row.linkedResources);
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
