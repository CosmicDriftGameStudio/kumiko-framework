import { isDeepStrictEqual } from "node:util";
import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import {
  type HandlerContext,
  type Registry,
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TemplateVariables,
  type TenantId,
  type TenantWriteTarget,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  ValidationError,
  VersionConflictError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { isPlainObject, propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { requireForTenant } from "../../shared/index.ts";
import { patchIssue } from "../document-op-blocks.ts";
import type { TemplateWriteScope } from "../layout-regions.ts";
import { type TemplateResourceRow, templateResourcesTable } from "../table.ts";
import { deliveryPolicyOf, findVariantsEntry } from "../template-delivery-policy.ts";
import { activationChanges, serializeTemplateDraft, toWorkingRow } from "../template-draft.ts";
import { refuseReservedSystemLayoutSlug } from "../template-edit-policy.ts";
import { isSystemOnlyTemplate } from "../template-system-only.ts";
import { resolveTemplateVariables, type TemplateValidation } from "../template-validation.ts";
import { readVariantOf, VARIANT_KIND, variantOfMatchesSlug } from "../template-variants.ts";
import { type ContentFormat, FALLBACK_LOCALE, type TemplateKind } from "../web/constants.ts";
import { TemplateResolverErrors } from "../web/qualified-names.ts";
import { executor } from "./shared.ts";
import {
  evaluateTemplateWrite,
  parseStoredJson,
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
  readonly version: number;
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
  /** Stored linkedResources JSON for a row that is created; an update never touches them. */
  readonly linkedResources?: string;
  /** The caller typed this schema itself (upsert); a variant then must match its base instead of being re-synced. */
  readonly explicitVariableSchema?: true;
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

// A tenant row under `<base>:<name>` of a base with variants must declare that base; otherwise the
// policy would serve it as a variant while schema sync never runs for it.
function refuseVariantOfSlugMismatch(
  registry: HandlerContext["registry"],
  scope: TemplateWriteScope,
  payload: TemplateRowWrite["payload"],
): WriteFailure | null {
  const declaredBase = readVariantOf(payload.meta);
  const requiredBase =
    scope === "tenant"
      ? findVariantsEntry(deliveryPolicyOf(registry).tenantEditable, payload)?.slug
      : undefined;
  const missesRequiredBase = requiredBase !== undefined && declaredBase !== requiredBase;
  if (!missesRequiredBase && variantOfMatchesSlug(payload.slug, payload.meta)) return null;
  return writeFailure(
    new ValidationError({ fields: [patchIssue("meta.variantOf", "invalid_variant_of")] }),
  );
}

function storedKeyOf(data: unknown): { readonly id: string; readonly version: number } {
  const id = propertyOf(data, "id");
  const version = propertyOf(propertyOf(data, "data"), "version");
  if ((typeof id !== "string" && typeof id !== "number") || typeof version !== "number") {
    throw new Error("template write: executor result carries no id and version");
  }
  return { id: String(id), version };
}

export type BaseSchemaView = "working" | "served";

// "working": the base as its author edits it (own row with open draft, else the served system default),
// so a variant draft can follow a base draft. "served": only what is delivered (own active row, else the
// active system default), so a published variant never carries variables the delivered base lacks.
export async function baseVariableSchemaOf(
  db: TenantWriteTarget["db"],
  tenantId: string,
  baseSlug: string,
  locale: string,
  view: BaseSchemaView,
): Promise<unknown> {
  const locales = locale === FALLBACK_LOCALE ? [locale] : [locale, FALLBACK_LOCALE];
  for (const candidateLocale of locales) {
    const where = { slug: baseSlug, kind: VARIANT_KIND, locale: candidateLocale };
    const own = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
      ...where,
      tenantId,
    });
    if (own !== undefined && view === "working") {
      return parseStoredJson(toWorkingRow(own, tenantId).variableSchema);
    }
    if (own !== undefined && own.status === "active") return parseStoredJson(own.variableSchema);
    const system = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
      ...where,
      tenantId: SYSTEM_TENANT_ID,
      scope: "system",
      status: "active",
    });
    if (system !== undefined) return parseStoredJson(system.variableSchema);
  }
  return undefined;
}

type VariantSchemaOutcome =
  | { readonly refused: WriteFailure }
  | { readonly payload: TemplateRowWrite["payload"]; readonly variables: TemplateVariables };

// A variant follows its base: a write that sends no schema of its own stores the base's current one,
// so a base that gains a variable does not lock its variants. A caller that sends a different
// schema explicitly is refused.
async function syncVariantSchema(
  args: TemplateRowWrite,
  db: TenantWriteTarget["db"],
): Promise<VariantSchemaOutcome> {
  const { payload } = args;
  const baseSlug = readVariantOf(payload.meta);
  const unchanged = { payload, variables: args.variables };
  if (args.scope !== "tenant" || baseSlug === null) return unchanged;
  const baseSchema = await baseVariableSchemaOf(
    db,
    args.tenantId,
    baseSlug,
    payload.locale,
    "working",
  );
  if (!isPlainObject(baseSchema)) return unchanged;
  if (args.explicitVariableSchema === true) {
    if (isDeepStrictEqual(baseSchema, payload.variableSchema)) return unchanged;
    return {
      refused: writeFailure(
        new ValidationError({
          fields: [
            patchIssue("variableSchema", "variables_inherited_from_base", { slug: baseSlug }),
          ],
        }),
      ),
    };
  }
  return {
    payload: { ...payload, variableSchema: baseSchema },
    variables: resolveTemplateVariables(args.ctx.registry, payload.slug, baseSchema),
  };
}

function refuseScopeViolation(
  registry: HandlerContext["registry"],
  scope: TemplateWriteScope,
  tenantId: TenantId,
  payload: TemplateRowWrite["payload"],
): WriteResult<never> | WriteFailure | null {
  return (
    refuseVariantOfSlugMismatch(registry, scope, payload) ??
    refuseTenantScopeUnderSystemTenant(scope, tenantId) ??
    refuseReservedSystemLayoutSlug(scope, payload, "slug") ??
    refuseSystemOnlyTenantOverride(registry, scope, payload.slug, payload.kind)
  );
}

// Shared by every template write: validate through the one pipeline, then
// create or update the (tenant, slug, kind, locale) row via the event-store
// executor. linkedResources is never part of an update; resources are attached
// separately.
export async function writeTemplateRow(
  args: TemplateRowWrite,
): Promise<WriteResult<WrittenTemplateRow>> {
  const { ctx, user, tenantId, scope, status } = args;
  const refused = refuseScopeViolation(ctx.registry, scope, tenantId, args.payload);
  if (refused !== null) return refused;
  const { db, streamTenantId } = requireForTenant(ctx, tenantId);
  const synced = await syncVariantSchema(args, db);
  if ("refused" in synced) return synced.refused;
  const { payload, variables } = synced;

  const gated = gateTemplateWrite(
    {
      kind: payload.kind,
      scope,
      contentFormat: payload.contentFormat,
      content: payload.content,
      rawMeta: payload.meta,
      variables,
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
        version: storedKeyOf(result.data).version,
        slug: payload.slug,
        isNew: false,
        validation: evaluated.validation,
      },
    };
  }

  const result = await executor.create(
    {
      ...fields,
      linkedResources: args.linkedResources ?? "{}",
      tenantId,
      draft: null,
      ...(status === "active" ? activationChanges(null) : {}),
    },
    user,
    db,
    { streamTenantId },
  );
  if (!result.isSuccess) return result;
  const created = storedKeyOf(result.data);
  return {
    isSuccess: true,
    data: {
      id: created.id,
      version: created.version,
      slug: payload.slug,
      isNew: true,
      validation: evaluated.validation,
    },
  };
}
