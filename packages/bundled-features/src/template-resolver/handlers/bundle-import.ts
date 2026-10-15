import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type {
  HandlerContext,
  SessionUser,
  TenantId,
  WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  type FieldIssue,
  ValidationError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { requireForTenant } from "../../shared/index.js";
import type { TemplateWriteScope } from "../layout-regions.js";
import { type TemplateResourceRow, templateResourcesTable } from "../table.js";
import type { TemplateBundle } from "../template-bundle.js";
import { storeTemplateResource } from "../template-resources.js";
import { resolveTemplateVariables } from "../template-validation.js";
import { evaluateTemplateWrite } from "./template-gates.js";
import {
  refuseTenantScopeUnderSystemTenant,
  type TemplateRowPayload,
  writeTemplateRow,
} from "./template-write.js";

export function targetExistsIssue(locale: string): FieldIssue {
  return {
    path: "locale",
    code: "target_exists",
    i18nKey: "templateResolver.errors.template.targetExists",
    params: { detail: locale },
  };
}

type BundleImport = {
  readonly ctx: HandlerContext;
  readonly user: SessionUser;
  readonly tenantId: TenantId;
  readonly scope: TemplateWriteScope;
  readonly bundle: TemplateBundle;
  readonly overwrite: boolean;
};

async function collectBundleIssues(args: BundleImport): Promise<readonly FieldIssue[]> {
  const { ctx, tenantId, scope, bundle, overwrite } = args;
  const { db } = requireForTenant(ctx, tenantId);
  const variables = resolveTemplateVariables(
    ctx.registry,
    bundle.slug,
    bundle.variableSchema ?? {},
  );
  const issues: FieldIssue[] = [];
  for (const [locale, entry] of Object.entries(bundle.locales)) {
    const evaluated = evaluateTemplateWrite({
      kind: bundle.kind,
      scope,
      contentFormat: bundle.contentFormat,
      content: entry.body,
      rawMeta: entry.meta,
      variables,
      resourceKeys: Object.keys(bundle.resources),
    });
    if (!evaluated.ok) {
      issues.push(
        ...evaluated.issues.map((issue) => ({ ...issue, path: `locales.${locale}.${issue.path}` })),
      );
    }
    if (!overwrite) {
      const existing = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
        tenantId,
        slug: bundle.slug,
        kind: bundle.kind,
        locale,
      });
      if (existing) issues.push(targetExistsIssue(locale));
    }
  }
  return issues;
}

async function storeBundleResources(
  args: BundleImport,
): Promise<WriteResult<Record<string, string>>> {
  const linked: Record<string, string> = {};
  for (const [key, resource] of Object.entries(args.bundle.resources)) {
    const stored = await storeTemplateResource(
      { db: args.ctx.db, files: args.ctx.files, registry: args.ctx.registry, user: args.user },
      {
        fileName: resource.fileName,
        contentType: resource.contentType,
        bytes: Uint8Array.from(Buffer.from(resource.base64, "base64")),
      },
    );
    if (!stored.isSuccess) return stored;
    linked[key] = stored.data;
  }
  return { isSuccess: true, data: linked };
}

// Validates every locale first, stores the resource files, then writes one row
// per locale, so a bad locale never leaves files or half a bundle behind.
export async function importTemplateBundle(
  args: BundleImport & { readonly status: "draft" | "active" },
): Promise<WriteResult<{ ids: Record<string, string> }>> {
  const refused = refuseTenantScopeUnderSystemTenant(args.scope, args.tenantId);
  if (refused !== null) return refused;
  const issues = await collectBundleIssues(args);
  if (issues.length > 0) return writeFailure(new ValidationError({ fields: [...issues] }));

  const linked = await storeBundleResources(args);
  if (!linked.isSuccess) return linked;

  const variableSchema = args.bundle.variableSchema ?? {};
  const variables = resolveTemplateVariables(args.ctx.registry, args.bundle.slug, variableSchema);
  const ids: Record<string, string> = {};
  for (const [locale, entry] of Object.entries(args.bundle.locales)) {
    const payload: TemplateRowPayload = {
      slug: args.bundle.slug,
      kind: args.bundle.kind,
      locale,
      content: entry.body,
      contentFormat: args.bundle.contentFormat,
      variableSchema,
      linkedResources: linked.data,
      meta: entry.meta,
    };
    const written = await writeTemplateRow({
      ctx: args.ctx,
      user: args.user,
      tenantId: args.tenantId,
      scope: args.scope,
      status: args.status,
      variables,
      payload,
    });
    if (!written.isSuccess) return written;
    ids[locale] = written.data.id;
  }
  return { isSuccess: true, data: { ids } };
}
