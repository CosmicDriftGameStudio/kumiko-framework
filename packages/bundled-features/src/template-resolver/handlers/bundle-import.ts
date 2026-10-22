import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import type {
  BeforeTransactionResult,
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
import { requireForTenant } from "../../shared/index.ts";
import type { TemplateWriteScope } from "../layout-regions.ts";
import type { LinkedResourceEntry } from "../linked-resources.ts";
import {
  attachmentLimitFailure,
  attachmentNeedsMailTemplate,
  createPreparedBundleResourceEntry,
  type PreparedTemplateFile,
  prepareTemplateAttachmentBeforeTransaction,
  prepareTemplateResourceBeforeTransaction,
  type Release,
  readTemplateResourceMaxBytes,
  releaseAfterFailure,
  releaseAll,
} from "../store-template-resource.ts";
import { type TemplateResourceRow, templateResourcesTable } from "../table.ts";
import type { TemplateBundle } from "../template-bundle.ts";
import { attachTemplateResources } from "../template-resources.ts";
import { resolveTemplateVariables } from "../template-validation.ts";
import { MAX_FILE_ATTACHMENTS_PER_TEMPLATE } from "./resource-shared.ts";
import { evaluateTemplateWrite } from "./template-gates.ts";
import {
  refuseSystemOnlyTenantOverride,
  refuseTenantScopeUnderSystemTenant,
  type TemplateRowPayload,
  writeTemplateRow,
} from "./template-write.ts";

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

type BundleImportStatus = "draft" | "active";

async function collectBundleIssues(
  args: BundleImport,
  status: BundleImportStatus,
): Promise<readonly FieldIssue[]> {
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
    });
    const found = evaluated.ok
      ? status === "active"
        ? evaluated.publishIssues
        : []
      : evaluated.issues;
    issues.push(...found.map((issue) => ({ ...issue, path: `locales.${locale}.${issue.path}` })));
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

export type PreparedBundleResources = ReadonlyMap<string, PreparedTemplateFile>;

function checkBundleAttachments(bundle: TemplateBundle): WriteResult<null> {
  const attachmentCount =
    Object.values(bundle.resources).filter((resource) => resource.purpose === "attachment").length +
    Object.keys(bundle.pdfAttachments).length;
  if (attachmentCount > 0 && bundle.kind !== "mail") return attachmentNeedsMailTemplate();
  if (attachmentCount > MAX_FILE_ATTACHMENTS_PER_TEMPLATE) return attachmentLimitFailure();
  return { isSuccess: true, data: null };
}

// beforeTransaction half: validates the bundle and uploads every resource file to the target
// tenant's storage. A failed or throwing upload releases the ones before it.
export async function prepareTemplateBundleBeforeTransaction(
  args: BundleImport & { readonly status: BundleImportStatus },
): Promise<BeforeTransactionResult<PreparedBundleResources>> {
  const refused =
    refuseTenantScopeUnderSystemTenant(args.scope, args.tenantId) ??
    refuseSystemOnlyTenantOverride(
      args.ctx.registry,
      args.scope,
      args.bundle.slug,
      args.bundle.kind,
    );
  if (refused !== null) return refused;
  const issues = await collectBundleIssues(args, args.status);
  if (issues.length > 0) return writeFailure(new ValidationError({ fields: [...issues] }));
  const attachmentCheck = checkBundleAttachments(args.bundle);
  if (!attachmentCheck.isSuccess) return attachmentCheck;

  const maxBytes = await readTemplateResourceMaxBytes(args.ctx.config, args.ctx.registry);
  const prepared = new Map<string, PreparedTemplateFile>();
  const releases: Release[] = [];
  try {
    // A bundle is untrusted input like an upload: the same re-encoding decides the stored
    // content type, so a declared image/png can't smuggle SVG or HTML into a mail or PDF.
    for (const [key, resource] of Object.entries(args.bundle.resources)) {
      const bytes = Uint8Array.from(Buffer.from(resource.base64, "base64"));
      const common = {
        ctx: args.ctx,
        user: args.user,
        tenantId: args.tenantId,
        bytes,
        maxBytes,
        key,
      };
      const result =
        resource.purpose === "attachment"
          ? await prepareTemplateAttachmentBeforeTransaction({
              ...common,
              fileName: resource.fileName,
            })
          : await prepareTemplateResourceBeforeTransaction(common);
      if (!result.isSuccess) {
        await releaseAfterFailure(args.ctx, releases);
        return result;
      }
      if (result.release) releases.push(result.release);
      prepared.set(key, result.data);
    }
  } catch (cause) {
    await releaseAfterFailure(args.ctx, releases);
    throw cause;
  }
  return { isSuccess: true, data: prepared, release: () => releaseAll(releases) };
}

async function linkPreparedBundleResources(
  args: BundleImport,
  prepared: PreparedBundleResources,
): Promise<WriteResult<Record<string, LinkedResourceEntry>>> {
  const linked: Record<string, LinkedResourceEntry> = {};
  // The document template is not looked up: a bundle may carry it later than the mail.
  for (const [key, link] of Object.entries(args.bundle.pdfAttachments)) {
    linked[key] = { kind: "rendered-pdf", ...link };
  }
  for (const [key, file] of prepared) {
    const entry = await createPreparedBundleResourceEntry(
      { ctx: args.ctx, user: args.user, tenantId: args.tenantId },
      file,
    );
    if (!entry.isSuccess) return entry;
    linked[key] = entry.data;
  }
  return { isSuccess: true, data: linked };
}

// Validates every locale first, so a bad locale is refused before anything is written.
// The resource files are uploaded in the beforeTransaction phase; a rolled-back transaction
// releases them there. A crash between the upload and the commit leaves the binaries unreferenced.
export async function importTemplateBundle(
  args: BundleImport & {
    readonly status: BundleImportStatus;
    readonly prepared: PreparedBundleResources;
  },
): Promise<WriteResult<{ ids: Record<string, string> }>> {
  const refused = refuseTenantScopeUnderSystemTenant(args.scope, args.tenantId);
  if (refused !== null) return refused;
  const issues = await collectBundleIssues(args, args.status);
  if (issues.length > 0) return writeFailure(new ValidationError({ fields: [...issues] }));

  const linked = await linkPreparedBundleResources(args, args.prepared);
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
      meta: entry.meta,
      ...(entry.title !== undefined && { title: entry.title }),
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
    const attached = await attachTemplateResources(args.ctx, {
      user: args.user,
      tenantId: args.tenantId,
      templateId: written.data.id,
      resources: linked.data,
    });
    if (!attached.isSuccess) return attached;
    ids[locale] = written.data.id;
  }
  return { isSuccess: true, data: { ids } };
}
