import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  defineWriteHandler,
  type HandlerContext,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  NotFoundError,
  ValidationError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import * as z from "zod";
import { requireForTenant } from "../../shared/index.js";
import { CONTENT_FORMATS } from "../constants.js";
import { parseLinkedResourceEntries } from "../linked-resources.js";
import { TemplateResolverErrors } from "../qualified-names.js";
import { type TemplateResourceRow, templateResourcesTable } from "../table.js";
import { toWorkingRow } from "../template-draft.js";
import { attachTemplateResources, duplicateLinkedResourceFiles } from "../template-resources.js";
import { resolveTemplateVariables } from "../template-validation.js";
import { targetExistsIssue } from "./bundle-import.js";
import { kindSchema, localeSchema, templateSlugSchema } from "./shared.js";
import { parseStoredJson, storedRecord } from "./template-gates.js";
import { refuseTenantScopeUnderSystemTenant, writeTemplateRow } from "./template-write.js";

type CopyScope = "tenant" | "system";
type WriteCtx = HandlerContext;

function readDbFor(ctx: WriteCtx, scope: CopyScope) {
  return scope === "system" ? requireForTenant(ctx, SYSTEM_TENANT_ID).db : ctx.db;
}

// A tenant copy may start from the system default; a system copy only from system rows.
async function findCopySource(
  ctx: WriteCtx,
  where: {
    scope: CopyScope;
    tenantId: string;
    slug: string;
    kind: string;
    locale: string;
  },
) {
  const { scope, tenantId, slug, kind, locale } = where;
  const readDb = readDbFor(ctx, scope);
  const own = await fetchOne<TemplateResourceRow>(readDb, templateResourcesTable, {
    tenantId,
    slug,
    kind,
    locale,
  });
  // An archived tenant row is not an active source: the system default applies instead.
  if (scope === "system" || (own && own.status !== "archived")) return own;
  return fetchOne<TemplateResourceRow>(readDb, templateResourcesTable, {
    tenantId: SYSTEM_TENANT_ID,
    slug,
    kind,
    locale,
    status: "active",
  });
}

export const copyLocaleWrite = defineWriteHandler({
  name: "copy-locale",
  schema: z.object({
    slug: templateSlugSchema,
    kind: kindSchema,
    fromLocale: localeSchema,
    toLocale: localeSchema,
    overwrite: z.boolean().default(false),
    /** "system" copies between system-default rows; SystemAdmin only. */
    scope: z.enum(["tenant", "system"]).default("tenant"),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Copies the text of one locale of a template into another locale as a draft override of the caller's tenant, taking the tenant's own row or else the system default as the source; use it as the starting point for a translation. It refuses an existing target unless overwrite is set. With scope system (SystemAdmin only) both source and target are system-default rows and the target lands as a system draft; any other caller gets a 403.",
  handler: async (event, ctx) => {
    const { slug, kind, fromLocale, toLocale, overwrite, scope } = event.payload;
    if (scope === "system" && !event.user.roles.includes("SystemAdmin")) {
      return writeFailure(
        new AccessDeniedError({
          i18nKey: "errors.access.denied",
          details: { reason: TemplateResolverErrors.systemAdminRequired },
        }),
      );
    }
    const tenantId = scope === "system" ? SYSTEM_TENANT_ID : event.user.tenantId;
    const refused = refuseTenantScopeUnderSystemTenant(scope, tenantId);
    if (refused !== null) return refused;

    const readDb = readDbFor(ctx, scope);
    const storedSource = await findCopySource(ctx, {
      scope,
      tenantId,
      slug,
      kind,
      locale: fromLocale,
    });
    const source = storedSource && toWorkingRow(storedSource, tenantId);
    if (!source || !isOneOf(CONTENT_FORMATS, source.contentFormat)) {
      return writeFailure(new NotFoundError("template-resource", `${slug}/${fromLocale}`));
    }

    if (!overwrite) {
      const target = await fetchOne<TemplateResourceRow>(readDb, templateResourcesTable, {
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
      scope,
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
    const sourceResources = parseLinkedResourceEntries(source.linkedResources);
    // A system source's files belong to the system tenant: the tenant gets its own copies so
    // previews, exports and the tenant's override keep working independent of the system row.
    const resources =
      source.tenantId === tenantId
        ? { isSuccess: true as const, data: sourceResources }
        : await duplicateLinkedResourceFiles(ctx, {
            user: event.user,
            tenantId,
            resources: sourceResources,
          });
    if (!resources.isSuccess) return resources;
    const attached = await attachTemplateResources(ctx, {
      user: event.user,
      tenantId,
      templateId: written.data.id,
      resources: resources.data,
    });
    if (!attached.isSuccess) return attached;
    return written;
  },
});
