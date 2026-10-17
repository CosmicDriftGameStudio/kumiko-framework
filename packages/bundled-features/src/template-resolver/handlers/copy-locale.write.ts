import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  defineWriteHandler,
  type HandlerContext,
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TenantId,
  type WriteResult,
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
import { CONTENT_FORMATS, type ContentFormat } from "../constants.js";
import { type LinkedResourceEntry, parseLinkedResourceEntries } from "../linked-resources.js";
import { TemplateResolverErrors } from "../qualified-names.js";
import {
  createLinkedResourceCopies,
  prepareLinkedResourceCopiesBeforeTransaction,
} from "../store-template-resource.js";
import { type TemplateResourceRow, templateResourcesTable } from "../table.js";
import { toWorkingRow, type WorkingRow } from "../template-draft.js";
import { attachTemplateResources } from "../template-resources.js";
import { resolveTemplateVariables } from "../template-validation.js";
import { targetExistsIssue } from "./bundle-import.js";
import { kindSchema, localeSchema, templateSlugSchema } from "./shared.js";
import { parseStoredJson, storedRecord } from "./template-gates.js";
import {
  refuseSystemOnlyTenantOverride,
  refuseTenantScopeUnderSystemTenant,
  writeTemplateRow,
} from "./template-write.js";

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

const copyLocaleSchema = z.object({
  slug: templateSlugSchema,
  kind: kindSchema,
  fromLocale: localeSchema,
  toLocale: localeSchema,
  overwrite: z.boolean().default(false),
  /** "system" copies between system-default rows; SystemAdmin only. */
  scope: z.enum(["tenant", "system"]).default("tenant"),
});

type CopyRequest = {
  readonly scope: CopyScope;
  readonly tenantId: TenantId;
  readonly source: WorkingRow;
  readonly contentFormat: ContentFormat;
  readonly sourceResources: Readonly<Record<string, LinkedResourceEntry>>;
  // A system source's files belong to the system tenant: the tenant gets its own copies so
  // previews, exports and the tenant's override keep working independent of the system row.
  readonly sourceIsForeign: boolean;
};

// Runs before the upload (reject early, store nothing) and again in the transaction on the fresh rows.
async function checkCopyRequest(
  ctx: WriteCtx,
  event: {
    readonly user: SessionUser;
    readonly payload: z.infer<typeof copyLocaleSchema>;
  },
): Promise<WriteResult<CopyRequest>> {
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
  const refused =
    refuseTenantScopeUnderSystemTenant(scope, tenantId) ??
    refuseSystemOnlyTenantOverride(ctx.registry, scope, slug, kind);
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
  const contentFormat = source?.contentFormat;
  if (!source || !isOneOf(CONTENT_FORMATS, contentFormat)) {
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
  return {
    isSuccess: true,
    data: {
      scope,
      tenantId,
      source,
      contentFormat,
      sourceResources: parseLinkedResourceEntries(source.linkedResources),
      sourceIsForeign: source.tenantId !== tenantId,
    },
  };
}

export const copyLocaleWrite = defineWriteHandler({
  name: "copy-locale",
  schema: copyLocaleSchema,
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Copies the text of one locale of a template into another locale as a draft override of the caller's tenant, taking the tenant's own row or else the system default as the source; use it as the starting point for a translation. It refuses an existing target unless overwrite is set. With scope system (SystemAdmin only) both source and target are system-default rows and the target lands as a system draft; any other caller gets a 403.",
  beforeTransaction: async (event, ctx) => {
    const request = await checkCopyRequest(ctx, event);
    if (!request.isSuccess) return request;
    if (!request.data.sourceIsForeign) return { isSuccess: true, data: [] };
    return prepareLinkedResourceCopiesBeforeTransaction({
      ctx,
      user: event.user,
      tenantId: request.data.tenantId,
      resources: request.data.sourceResources,
    });
  },
  handler: async (event, ctx) => {
    const { slug, kind, toLocale } = event.payload;
    const request = await checkCopyRequest(ctx, event);
    if (!request.isSuccess) return request;
    const { scope, tenantId, source, contentFormat, sourceResources, sourceIsForeign } =
      request.data;

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
        contentFormat,
        variableSchema,
        meta: parseStoredJson(source.meta),
        title: source.title,
        folder: source.folder,
      },
    });
    if (!written.isSuccess) return written;
    const resources = sourceIsForeign
      ? await createLinkedResourceCopies({ ctx, user: event.user, tenantId }, event.prepared)
      : { isSuccess: true as const, data: sourceResources };
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
