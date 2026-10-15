import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineWriteHandler, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, ValidationError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import * as z from "zod";
import { CONTENT_FORMATS } from "../constants.js";
import { type TemplateResourceRow, templateResourcesTable } from "../table.js";
import { attachTemplateResources } from "../template-resources.js";
import { resolveTemplateVariables } from "../template-validation.js";
import { targetExistsIssue } from "./bundle-import.js";
import { kindSchema, localeSchema, templateSlugSchema } from "./shared.js";
import { parseStoredJson, storedRecord } from "./template-gates.js";
import { refuseTenantScopeUnderSystemTenant, writeTemplateRow } from "./template-write.js";

function stringRecord(raw: string | null): Record<string, string> {
  return Object.fromEntries(
    Object.entries(storedRecord(raw)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export const copyLocaleWrite = defineWriteHandler({
  name: "copy-locale",
  schema: z.object({
    slug: templateSlugSchema,
    kind: kindSchema,
    fromLocale: localeSchema,
    toLocale: localeSchema,
    overwrite: z.boolean().default(false),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Copies the text of one locale of a template into another locale as a draft override of the caller's tenant, taking the tenant's own row or else the system default as the source; use it as the starting point for a translation. It refuses an existing target unless overwrite is set.",
  handler: async (event, ctx) => {
    const { slug, kind, fromLocale, toLocale, overwrite } = event.payload;
    const tenantId = event.user.tenantId;
    const refused = refuseTenantScopeUnderSystemTenant("tenant", tenantId);
    if (refused !== null) return refused;

    const source =
      (await fetchOne<TemplateResourceRow>(ctx.db, templateResourcesTable, {
        tenantId,
        slug,
        kind,
        locale: fromLocale,
      })) ??
      (await fetchOne<TemplateResourceRow>(ctx.db, templateResourcesTable, {
        tenantId: SYSTEM_TENANT_ID,
        slug,
        kind,
        locale: fromLocale,
        status: "active",
      }));
    if (!source || !isOneOf(CONTENT_FORMATS, source.contentFormat)) {
      return writeFailure(new NotFoundError("template-resource", `${slug}/${fromLocale}`));
    }

    if (!overwrite) {
      const target = await fetchOne<TemplateResourceRow>(ctx.db, templateResourcesTable, {
        tenantId,
        slug,
        kind,
        locale: toLocale,
      });
      if (target) {
        return writeFailure(new ValidationError({ fields: [targetExistsIssue(toLocale)] }));
      }
    }

    const variableSchema = storedRecord(source.variableSchema);
    const written = await writeTemplateRow({
      ctx,
      user: event.user,
      tenantId,
      scope: "tenant",
      status: "draft",
      variables: resolveTemplateVariables(ctx.registry, slug, variableSchema),
      payload: {
        slug,
        kind,
        locale: toLocale,
        content: source.content,
        contentFormat: source.contentFormat,
        variableSchema,
        meta: parseStoredJson(source.meta),
        title: source.title,
        folder: source.folder,
      },
    });
    if (!written.isSuccess) return written;
    // A system source carries no files of its own: its resource keys are known to the tenant row anyway.
    if (source.tenantId === tenantId) {
      const attached = await attachTemplateResources(ctx, {
        user: event.user,
        tenantId,
        templateId: written.data.id,
        resources: stringRecord(source.linkedResources),
      });
      if (!attached.isSuccess) return attached;
    }
    return written;
  },
});
