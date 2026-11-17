import {
  type AccessRule,
  bootRuleError,
  defineFeature,
  type FeatureDefinition,
  type FeatureRegistrar,
} from "@cosmicdrift/kumiko-framework/engine";
import { resolveFeatureAccess } from "../shared/index.ts";
import { FIELD_APPROVAL_BOOT_RULES } from "./boot-rules.ts";
import { DEFAULT_FIELD_APPROVAL_ACCESS, FIELD_APPROVAL_FEATURE_NAME } from "./constants.ts";
import { createFieldChangeRequestEntity } from "./entity.ts";
import { createFieldChangeRequestExecutor } from "./executor.ts";
import { createApproveChangeHandler } from "./handlers/approve-change.write.ts";
import { createPendingChangesQuery } from "./handlers/pending-changes.query.ts";
import { createRejectChangeHandler } from "./handlers/reject-change.write.ts";
import { createRequestChangeHandler } from "./handlers/request-change.write.ts";

function registerFieldApproval(
  r: FeatureRegistrar<typeof FIELD_APPROVAL_FEATURE_NAME>,
  access: AccessRule,
  parents: readonly string[],
): void {
  r.describe(
    "Four-eyes approval for payment-relevant fields. A host field declares `access.approve: [roles]`; the executor then refuses a direct change by anyone without one of those roles (403 field_approval_required). The caller files the change with request-change, which stores it as a pending request; a different person holding an approve role applies it with approve-change or declines it with reject-change (the requester may also withdraw). pending-changes lists the open requests the caller may decide or has filed. The requested value is encrypted under the host record's subject, so forgetting the host makes it unreadable. Mount with createFieldApprovalFeature({ parents: [<host entities>] }).",
  );
  r.uiHints({
    displayLabel: "Field approval",
    category: "data",
    recommended: false,
  });

  r.entity(createFieldChangeRequestEntity(parents));
  const requestExecutor = createFieldChangeRequestExecutor(parents);
  r.writeHandler(createRequestChangeHandler(access, requestExecutor));
  r.writeHandler(createApproveChangeHandler(access, requestExecutor));
  r.writeHandler(createRejectChangeHandler(access, requestExecutor));
  r.queryHandler(createPendingChangesQuery(access, requestExecutor));
}

export type FieldApprovalFeatureOptions = {
  /** Access rule for all four paths. Takes precedence over `roles`. Default { roles: ["TenantAdmin","TenantMember"] }. */
  readonly access?: AccessRule;
  /** Shorthand for { access: { roles } }. Ignored when `access` is set. */
  readonly roles?: readonly string[];
  /** Host entities whose fields may declare access.approve. Required and non-empty. */
  readonly parents: readonly string[];
};

export function createFieldApprovalFeature(opts: FieldApprovalFeatureOptions): FeatureDefinition {
  if (opts.parents.length === 0) {
    throw bootRuleError(FIELD_APPROVAL_BOOT_RULES.emptyParentsAllowlist, {
      message:
        "createFieldApprovalFeature({ parents }): parents must not be an empty array — " +
        "no host field could be approved. List at least one host entity.",
    });
  }
  return defineFeature(FIELD_APPROVAL_FEATURE_NAME, (r) =>
    registerFieldApproval(
      r,
      resolveFeatureAccess(opts, DEFAULT_FIELD_APPROVAL_ACCESS),
      opts.parents,
    ),
  );
}
