import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { TenantQueries } from "../../tenant/index.js";
import { type TemplateResourceRow, templateResourcesTable } from "../table.js";
import { kindSchema, localeSchema, templateSlugSchema } from "./shared.js";

const TENANT_OVERRIDES_REASON =
  "SystemAdmin template overview counts how many tenants override one system template; it reads tenant-scope template rows of every tenant and returns only counts, never tenant ids or content";

const tenantIdsSchema = z.array(z.string());

type OverrideRow = Pick<TemplateResourceRow, "tenantId" | "status">;

export const tenantOverridesQuery = defineQueryHandler({
  name: "tenant-overrides",
  schema: z.object({
    slug: templateSlugSchema,
    kind: kindSchema,
    locale: localeSchema.optional(),
  }),
  access: { roles: ["SystemAdmin"] },
  description:
    "Counts how many enabled tenants override one template with an active or a draft version, next to the number of enabled tenants; use it before changing a system template to see how many tenants keep their own copy. Returns counts only, no tenant ids.",
  escapeHatch: { grants: ["unsafeRaw"], reason: TENANT_OVERRIDES_REASON },
  handler: async (query, ctx) => {
    const { slug, kind, locale } = query.payload;
    const rows = await selectMany<OverrideRow>(ctx.db.unsafeRaw(), templateResourcesTable, {
      slug,
      kind,
      scope: "tenant",
      ...(locale === undefined ? {} : { locale }),
    });

    const hasTenantFeature =
      ctx.registry.getQueryHandler(TenantQueries.activeTenantIds) !== undefined;
    const enabledTenantIds = hasTenantFeature
      ? new Set(tenantIdsSchema.parse(await ctx.query(TenantQueries.activeTenantIds, {})))
      : null;

    const statusByTenant = new Map<string, "active" | "draft">();
    for (const row of rows) {
      if (row.tenantId === SYSTEM_TENANT_ID || row.status === "archived") continue;
      if (enabledTenantIds !== null && !enabledTenantIds.has(row.tenantId)) continue;
      if (statusByTenant.get(row.tenantId) === "active") continue;
      statusByTenant.set(row.tenantId, row.status === "active" ? "active" : "draft");
    }
    const statuses = [...statusByTenant.values()];
    return {
      activeOverrides: statuses.filter((status) => status === "active").length,
      draftOverrides: statuses.filter((status) => status === "draft").length,
      totalTenants: enabledTenantIds === null ? null : enabledTenantIds.size,
    };
  },
});
