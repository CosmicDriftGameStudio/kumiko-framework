import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { type TemplateResourceRow, templateResourcesTable } from "../table.js";
import { buildOverrideDiff } from "./override-diff.js";

export const diffToSystemQuery = defineQueryHandler({
  name: "diff-to-system",
  schema: z.object({ id: z.string().min(1) }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Compares one tenant override with the system template of the same slug, kind and locale block by block and lists the changed meta settings; use it to show what an override changes before resetting it to the system version.",
  handler: async (query, ctx) => {
    const tenantRow = await fetchOne<TemplateResourceRow>(ctx.db, templateResourcesTable, {
      id: query.payload.id,
    });
    if (!tenantRow || tenantRow.tenantId !== query.user.tenantId || tenantRow.scope !== "tenant") {
      throw new NotFoundError("template-resource", query.payload.id);
    }
    const systemRow = await fetchOne<TemplateResourceRow>(ctx.db, templateResourcesTable, {
      tenantId: SYSTEM_TENANT_ID,
      slug: tenantRow.slug,
      kind: tenantRow.kind,
      locale: tenantRow.locale,
    });
    if (!systemRow) throw new NotFoundError("template-resource", tenantRow.slug);

    return buildOverrideDiff(tenantRow, systemRow);
  },
});
