import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  type HandlerContext,
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TemplateVariables,
  type TenantId,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  ValidationError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { requireForTenant } from "../../shared/index.js";
import type { ContentFormat, TemplateKind } from "../constants.js";
import type { TemplateWriteScope } from "../layout-regions.js";
import { type TemplateResourceRow, templateResourcesTable } from "../table.js";
import type { TemplateValidation } from "../template-validation.js";
import { executor } from "./shared.js";
import { evaluateTemplateWrite } from "./template-gates.js";

export type TemplateRowPayload = {
  readonly slug: string;
  readonly kind: TemplateKind;
  readonly locale: string;
  readonly content: string | null;
  readonly contentFormat: ContentFormat;
  readonly variableSchema: Readonly<Record<string, unknown>>;
  readonly linkedResources: Readonly<Record<string, string>>;
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

// Shared by every template write: validate through the one pipeline, then
// create or update the (tenant, slug, kind, locale) row via the event-store
// executor.
export async function writeTemplateRow(
  args: TemplateRowWrite,
): Promise<WriteResult<WrittenTemplateRow>> {
  const { ctx, user, tenantId, scope, status, payload } = args;
  const refused = refuseTenantScopeUnderSystemTenant(scope, tenantId);
  if (refused !== null) return refused;
  const { db, streamTenantId } = requireForTenant(ctx, tenantId);

  const evaluated = evaluateTemplateWrite({
    kind: payload.kind,
    scope,
    contentFormat: payload.contentFormat,
    content: payload.content,
    rawMeta: payload.meta,
    variables: args.variables,
    resourceKeys: Object.keys(payload.linkedResources),
  });
  if (!evaluated.ok) return writeFailure(new ValidationError({ fields: [...evaluated.issues] }));
  if (status === "active" && evaluated.publishIssues.length > 0) {
    return writeFailure(new ValidationError({ fields: [...evaluated.publishIssues] }));
  }

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
    linkedResources: JSON.stringify(payload.linkedResources),
    meta: evaluated.metaJson,
    title: payload.title ?? null,
    folder: payload.folder ?? null,
    scope,
    parentTemplateId: payload.parentTemplateId ?? null,
    status,
  };

  if (existing) {
    const result = await executor.update(
      { id: existing.id, version: existing.version, changes: fields },
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

  const result = await executor.create({ ...fields, tenantId }, user, db, { streamTenantId });
  if (!result.isSuccess) return result;
  // @cast-boundary db-row — executor.create returnt Record-row aus
  // INSERT RETURNING; shape { id } ist garantiert weil PK in der
  // Returning-Klausel ist.
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
