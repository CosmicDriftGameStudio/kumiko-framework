import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import {
  type HandlerContext,
  hasAccess,
  type RoleAccessRule,
  type SessionUser,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  ValidationError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { type TemplateResourceRow, templateResourcesTable } from "./table.ts";
import { isTenantLayout } from "./template-delivery-policy.ts";
import { isSystemAdmin } from "./template-draft.ts";
import { TENANT_LAYOUT_SLUG_PREFIX, type TemplateKind } from "./web/constants.ts";
import { TemplateResolverErrors } from "./web/qualified-names.ts";

export type TenantEditableTemplate = {
  readonly kind: TemplateKind;
  readonly slug: string;
  readonly access: RoleAccessRule;
};

export type TemplateEditPolicy = {
  readonly tenantEditable: readonly TenantEditableTemplate[];
};

type EditTarget = { readonly slug: string; readonly kind: string };
type EditUser = Pick<SessionUser, "roles">;

const SYSTEM_ADMIN_ROLE = "SystemAdmin";

export function templateEditAccess(entries: readonly TenantEditableTemplate[]): RoleAccessRule {
  const roles = new Set<string>([SYSTEM_ADMIN_ROLE]);
  for (const entry of entries) {
    for (const role of entry.access.roles) roles.add(role);
  }
  return { roles: [...roles] };
}

export function mayEditTemplate(
  policy: TemplateEditPolicy,
  user: EditUser,
  target: EditTarget,
): boolean {
  if (isSystemAdmin(user)) return true;
  if (isTenantLayout(target)) return mayEditTenantLayouts(policy, user);
  const entry = policy.tenantEditable.find(
    (candidate) => candidate.slug === target.slug && candidate.kind === target.kind,
  );
  return entry !== undefined && hasAccess(user, entry.access);
}

export function refuseTemplateEdit(
  policy: TemplateEditPolicy,
  user: EditUser,
  target: EditTarget,
): WriteFailure | null {
  if (mayEditTemplate(policy, user, target)) return null;
  return writeFailure(
    new AccessDeniedError({
      i18nKey: "templateResolver.errors.templateNotTenantEditable",
      details: { reason: TemplateResolverErrors.templateNotTenantEditable },
    }),
  );
}

// Fail closed: a missing row gives a non-SystemAdmin the same refusal as a locked one,
// so the response never reveals whether an id exists. SystemAdmin keeps the 404.
export function refuseMissingTemplate(
  policy: TemplateEditPolicy,
  user: EditUser,
): WriteFailure | null {
  return isSystemAdmin(user) ? null : refuseTemplateEdit(policy, user, { slug: "", kind: "" });
}

export async function refuseTemplateEditById(
  db: HandlerContext["db"],
  policy: TemplateEditPolicy,
  user: EditUser,
  tenantId: string,
  templateId: string,
): Promise<WriteFailure | null> {
  if (isSystemAdmin(user)) return null;
  const row = await fetchOne<TemplateResourceRow>(db, templateResourcesTable, {
    tenantId,
    id: templateId,
  });
  return row === undefined
    ? refuseMissingTemplate(policy, user)
    : refuseTemplateEdit(policy, user, row);
}

// A tenant may build its own layouts as soon as it may edit any PDF template; layouts have no entry of their own.
function mayEditTenantLayouts(policy: TemplateEditPolicy, user: EditUser): boolean {
  return policy.tenantEditable.some(
    (entry) => entry.kind === "document-pdf" && hasAccess(user, entry.access),
  );
}

// System layouts must not take a slug from the tenant namespace.
export function refuseReservedLayoutSlug(target: EditTarget, path: string): WriteFailure | null {
  if (!isTenantLayout(target)) return null;
  return writeFailure(
    new ValidationError({
      fields: [
        {
          path,
          code: "reserved_layout_slug",
          i18nKey: "templateResolver.errors.template.reservedLayoutSlug",
          params: { prefix: TENANT_LAYOUT_SLUG_PREFIX },
        },
      ],
    }),
  );
}
