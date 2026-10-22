import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import {
  type HandlerContext,
  type Registry,
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TemplateVariables,
  type TenantId,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  ValidationError,
  VersionConflictError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { requireForTenant } from "../../shared/index.ts";
import type { TemplateWriteScope } from "../layout-regions.ts";
import { type TemplateResourceRow, templateResourcesTable } from "../table.ts";
import { activationChanges, serializeTemplateDraft } from "../template-draft.ts";
import { isSystemOnlyTemplate } from "../template-system-only.ts";
import type { TemplateValidation } from "../template-validation.ts";
import type { ContentFormat, TemplateKind } from "../web/constants.ts";
import { TemplateResolverErrors } from "../web/qualified-names.ts";
import { executor } from "./shared.ts";
import {
  evaluateTemplateWrite,
  type TemplateWriteInput,
  type TemplateWriteResult,
} from "./template-gates.ts";

export type TemplateRowPayload = {
  readonly slug: string;
  readonly kind: TemplateKind;
  readonly locale: string;
  readonly content: string | null;
  readonly contentFormat: ContentFormat;
  readonly variableSchema: Readonly<Record<string, unknown>>;
  readonly meta?: unknown;
  readonly title?: string | null | undefined;
  readonly folder?: string | null | undefined;
  readonly parentTemplateId?: string | null | undefined;
};

export type WrittenTemplateRow = {
  readonly id: string;
  readonly slug: string;
  readonly isNew: boolean;
  readonly validation: TemplateValidation | null;
};

export type TemplateRowWrite = {
  readonly ctx: HandlerContext;
  readonly user: SessionUser;
  readonly tenantId: TenantId;
  readonly scope: TemplateWriteScope;
  readonly status: "draft" | "active";
  readonly variables: TemplateVariables;
  readonly payload: TemplateRowPayload;
  /** The row version the edit was made against; null means no own row may exist yet. */
  readonly expectedVersion?: number | null;
};

// The tenant-scope-under-system-tenant ban lives here so no write path can
// create the inconsistent state the resolver does not model.
export function refuseTenantScopeUnderSystemTenant(
  scope: TemplateWriteScope,
  tenantId: string,
): WriteResult<never> | null {
  if (scope !== "tenant" || tenantId !== SYSTEM_TENANT_ID) return null;
  return writeFailure(
    new AccessDeniedError({
      i18nKey: "templateResolver.errors.useUpsertSystemForSystemTenant",
      details: { reason: "system_tenant_override_not_allowed_use_upsert_system" },
    }),
  );
}

export function refuseSystemOnlyTenantOverride(
  registry: Registry,
  scope: TemplateWriteScope,
  slug: string,
  kind: string,
): WriteFailure | null {
  if (scope !== "tenant" || !isSystemOnlyTemplate(registry, slug, kind)) return null;
  return writeFailure(
    new AccessDeniedError({
      i18nKey: "templateResolver.errors.systemOnlyTemplate",
      details: { reason: TemplateResolverErrors.systemOnlyTemplate },
    }),
  );
}

export type GatedTemplateWrite =
  | { readonly ok: true; readonly evaluated: Extract<TemplateWriteResult, { ok: true }> }
  | { readonly ok: false; readonly failure: WriteFailure };

// Evaluation plus the publish rule: a row that goes active must not carry
// publish issues, a draft may.
export function gateTemplateWrite(
  input: TemplateWriteInput,
  status: "draft" | "active",
): GatedTemplateWrite {
  const evaluated = evaluateTemplateWrite(input);
  if (!evaluated.ok) {
    return {
      ok: false,
      failure: writeFailure(new ValidationError({ fields: [...evaluated.issues] })),
    };
  }
  if (status === "active" && evaluated.publishIssues.length > 0) {
    return {
      ok: false,
      failure: writeFailure(new ValidationError({ fields: [...evaluated.publishIssues] })),
    };
  }
  return { ok: true, evaluated };
}

type TemplateRowFields = {
  readonly content: string | null;
  readonly contentFormat: ContentFormat;
  readonly variableSchema: string;
  readonly meta: string | null;
  readonly title: string | null;
  readonly folder: string | null;
  readonly parentTemplateId: string | null;
};

// A draft over an active row is stored beside it; every other write replaces the main fields.
function updateChanges(
  existing: TemplateResourceRow,
  status: "draft" | "active",
  fields: TemplateRowFields,
): Record<string, unknown> {
  if (status === "active") return { ...fields, ...activationChanges(existing) };
  if (existing.status !== "active") return { ...fields, status, draft: null };
  const draft = serializeTemplateDraft({
    content: fields.content,
    contentFormat: fields.contentFormat,
    variableSchema: fields.variableSchema,
    meta: fields.meta,
    title: fields.title,
    folder: fields.folder,
    parentTemplateId: fields.parentTemplateId,
  });
  return existing.activeVersion === null
    ? {
        draft,
        activeVersion: existing.version,
        activeSince: existing.modifiedAt ?? existing.insertedAt,
      }
    : { draft };
}

function versionConflictFor(
  expectedVersion: number | null | undefined,
  existing: TemplateResourceRow | undefined,
  slug: string,
): WriteFailure | null {
  if (expectedVersion === undefined || (existing?.version ?? null) === expectedVersion) return null;
  return writeFailure(
    new VersionConflictError({
      entityId: existing?.id ?? slug,
      expectedVersion: expectedVersion ?? 0,
      currentVersion: existing?.version ?? 0,
    }),
  );
}

// Shared by every template write: validate through the one pipeline, then
// create or update the (tenant, slug, kind, locale) row via the event-store
// executor. linkedResources is never part of an update; resources are attached
// separately.
export async function writeTemplateRow(
  args: TemplateRowWrite,
): Promise<WriteResult<WrittenTemplateRow>> {
  const { ctx, user, tenantId, scope, status, payload } = args;
  const refused =
    refuseTenantScopeUnderSystemTenant(scope, tenantId) ??
    refuseSystemOnlyTenantOverride(ctx.registry, scope, payload.slug, payload.kind);
  if (refused !== null) return refused;
  const { db, streamTenantId } = requireForTenant(ctx, tenantId);

  const gated = gateTemplateWrite(
    {
      kind: payload.kind,
      scope,
      contentFormat: payload.contentFormat,
      content: payload.content,
      rawMeta: payload.meta,
      variables: args.variables,
    },
    status,
  );
  if (!gated.ok) return gated.failure;
  const { evaluated } = gated;

  const existing = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
    tenantId,
    slug: payload.slug,
    kind: payload.kind,
    locale: payload.locale,
  });

  const fields = {
    slug: payload.slug,
    kind: payload.kind,
    locale: payload.locale,
    content: evaluated.content,
    contentFormat: payload.contentFormat,
    variableSchema: JSON.stringify(payload.variableSchema),
    meta: evaluated.metaJson,
    title: payload.title ?? null,
    folder: payload.folder ?? null,
    scope,
    parentTemplateId: payload.parentTemplateId ?? null,
    status,
  };

  const conflict = versionConflictFor(args.expectedVersion, existing, payload.slug);
  if (conflict !== null) return conflict;

  if (existing) {
    const result = await executor.update(
      {
        id: existing.id,
        version: args.expectedVersion ?? existing.version,
        changes: updateChanges(existing, status, fields),
      },
      user,
      db,
      { streamTenantId },
    );
    if (!result.isSuccess) return result;
    return {
      isSuccess: true,
      data: {
        id: String(existing.id),
        slug: payload.slug,
        isNew: false,
        validation: evaluated.validation,
      },
    };
  }

  const result = await executor.create(
    {
      ...fields,
      linkedResources: "{}",
      tenantId,
      draft: null,
      ...(status === "active" ? activationChanges(null) : {}),
    },
    user,
    db,
    { streamTenantId },
  );
  if (!result.isSuccess) return result;
  // @cast-boundary db-row — executor.create returns a row from
  // INSERT RETURNING; the { id } shape is guaranteed because the primary key is in the
  // RETURNING clause.
  const createdRow = result.data as { id: string | number };
  return {
    isSuccess: true,
    data: {
      id: String(createdRow.id),
      slug: payload.slug,
      isNew: true,
      validation: evaluated.validation,
    },
  };
}
