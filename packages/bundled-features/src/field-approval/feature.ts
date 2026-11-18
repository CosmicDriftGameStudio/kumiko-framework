import {
  type AccessRule,
  type AdminNavArea,
  bootRuleError,
  defineFeature,
  type FeatureDefinition,
  type FeatureRegistrar,
} from "@cosmicdrift/kumiko-framework/engine";
import { resolveFeatureAccess } from "../shared/index.ts";
import { FIELD_APPROVAL_BOOT_RULES } from "./boot-rules.ts";
import {
  DEFAULT_FIELD_APPROVAL_ACCESS,
  FIELD_APPROVAL_FEATURE_NAME,
  FIELD_APPROVAL_LIST_SCREEN_ID,
} from "./constants.ts";
import { createFieldChangeRequestEntity } from "./entity.ts";
import { createFieldChangeRequestExecutor } from "./executor.ts";
import { createApproveChangeHandler } from "./handlers/approve-change.write.ts";
import { createPendingChangesQuery } from "./handlers/pending-changes.query.ts";
import { createRejectChangeHandler } from "./handlers/reject-change.write.ts";
import { createRequestChangeHandler } from "./handlers/request-change.write.ts";
import { FIELD_APPROVAL_I18N } from "./i18n.ts";
import { createFieldChangeRequestListScreen } from "./screens.ts";

const DEFAULT_NAV_ORDER = 40;

function registerFieldApproval(
  r: FeatureRegistrar<typeof FIELD_APPROVAL_FEATURE_NAME>,
  access: AccessRule,
  listAccess: AccessRule,
  parents: readonly string[],
  nav: FieldApprovalNavOptions,
): void {
  r.describe(
    "Four-eyes approval for payment-relevant fields. A host field declares `access.approve: [roles]`; the executor then refuses a direct change by anyone without one of those roles (403 field_approval_required). The caller files the change with request-change, which stores it as a pending request; a different person holding an approve role applies it with approve-change or declines it with reject-change (the requester may also withdraw). pending-changes lists the open requests the caller may decide or has filed; the approval list screen shows them with approve, reject and withdraw actions, its nav entry sits in the tenant admin area unless the app passes `nav`. The requested value is encrypted under the host record's subject, so forgetting the host makes it unreadable. Mount with createFieldApprovalFeature({ parents: [<host entities>] }).",
  );
  r.uiHints({
    displayLabel: "Field approval",
    category: "data",
    recommended: false,
  });

  r.translations({ keys: FIELD_APPROVAL_I18N });
  r.entity(createFieldChangeRequestEntity(parents));
  const requestExecutor = createFieldChangeRequestExecutor(parents);
  r.writeHandler(createRequestChangeHandler(access, requestExecutor));
  r.writeHandler(createApproveChangeHandler(access, requestExecutor));
  r.writeHandler(createRejectChangeHandler(access, requestExecutor));
  r.queryHandler(createPendingChangesQuery(access, requestExecutor));

  r.screen(createFieldChangeRequestListScreen(listAccess));
  // Explicit property assignments: the feature-AST parser reads neither `??`, shorthand
  // properties nor a conditional spread.
  const {
    order: navOrder = DEFAULT_NAV_ORDER,
    parent: navParent,
    workspaces: navWorkspaces,
    adminArea: navAdminArea = "tenant",
  } = nav;
  r.nav({
    id: FIELD_APPROVAL_LIST_SCREEN_ID,
    label: "field-approval:nav.fieldChangeRequests",
    icon: "shield-check",
    screen: `${FIELD_APPROVAL_FEATURE_NAME}:screen:${FIELD_APPROVAL_LIST_SCREEN_ID}`,
    order: navOrder,
    parent: navParent,
    workspaces: navWorkspaces,
    adminArea: navAdminArea,
    access: listAccess,
  });
}

export type FieldApprovalNavOptions = {
  readonly order?: number;
  /** Nav id of an app group to place the entry under. */
  readonly parent?: string;
  readonly workspaces?: readonly string[];
  /** Default "tenant". */
  readonly adminArea?: AdminNavArea;
};

export type FieldApprovalFeatureOptions = {
  /** Access rule for all four paths. Takes precedence over `roles`. Default { roles: ["TenantAdmin","TenantMember"] }. */
  readonly access?: AccessRule;
  /** Shorthand for { access: { roles } }. Ignored when `access` is set. */
  readonly roles?: readonly string[];
  /** Host entities whose fields may declare access.approve. Required and non-empty. */
  readonly parents: readonly string[];
  /** Roles that see the approval list and its nav entry in addition to the feature access,
   *  usually the union of the host fields' access.approve roles. Default: the feature access. */
  readonly approverRoles?: readonly string[];
  readonly nav?: FieldApprovalNavOptions;
};

// A requester withdraws their request from the list, so the list stays open to every role
// that may file one; pending-changes still returns only rows the caller may decide or filed.
function approvalListAccess(
  access: AccessRule,
  approverRoles: readonly string[] | undefined,
): AccessRule {
  if (approverRoles === undefined || !("roles" in access)) return access;
  return { ...access, roles: [...new Set([...approverRoles, ...access.roles])] };
}

export function createFieldApprovalFeature(opts: FieldApprovalFeatureOptions): FeatureDefinition {
  if (opts.parents.length === 0) {
    throw bootRuleError(FIELD_APPROVAL_BOOT_RULES.emptyParentsAllowlist, {
      message:
        "createFieldApprovalFeature({ parents }): parents must not be an empty array — " +
        "no host field could be approved. List at least one host entity.",
    });
  }
  const access = resolveFeatureAccess(opts, DEFAULT_FIELD_APPROVAL_ACCESS);
  const listAccess = approvalListAccess(access, opts.approverRoles);
  return defineFeature(FIELD_APPROVAL_FEATURE_NAME, (r) =>
    registerFieldApproval(r, access, listAccess, opts.parents, opts.nav ?? {}),
  );
}
