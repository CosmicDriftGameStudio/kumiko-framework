import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { USER_STATUS, userTable } from "../../user";
import { denyIfTargetOutsideAdminTenant } from "../lib/deny-if-target-outside-admin-tenant";
import { updateUserLifecycle } from "../lib/update-user-lifecycle";

const LIFT_RESTRICTION_ESCAPE_HATCH_REASON =
  "checks the target user's membership in the admin's tenant and appends the user lifecycle status change on the SYSTEM_TENANT_ID user stream, both via DbRunner helpers outside the admin's own tenant scope.";
const CHECK_TARGET_MEMBERSHIP_REASON =
  "checks the target user's membership in the admin's tenant via the DbRunner helper";
const APPEND_LIFECYCLE_EVENT_REASON =
  "appends the user lifecycle event on the SYSTEM_TENANT_ID user stream";

// POST /api/user/lift-restriction (S2.U6) — DSGVO Art. 18 Reverse.
//
// Operator-only. A Restricted user's own session is unconditionally
// rejected by sessionChecker (BLOCKED_STATUSES) the moment their status
// flips — their JWT/login can't reach this or any other authenticated
// endpoint. There is no self-service path today, so lifting a restriction
// always targets someone else's account by id.
//
// Tenant scope: `access.admin` includes TenantAdmin (tenant-scoped) even
// though the User-entity is global — see user-data-rights.md "Cross-Tenant-Semantik". Without a membership check, a TenantAdmin
// from tenant A could unrestrict/reactivate a user who has never been a
// member of tenant A. Only SystemAdmin (platform-wide) skips the check;
// the target must have a membership row in the acting admin's
// `event.user.tenantId` (row existence only — no active-status field).
//
// State-Transitions:
//   Restricted → Active        ✓
//   Active → ...               ✗ 422 not_restricted (Idempotenz-Guard)
//   DeletionRequested → ...    ✗ 422 not_restricted
//   Deleted → ...              ✗ 422 not_restricted
export const liftRestrictionWrite = defineWriteHandler({
  name: "lift-restriction",
  schema: z.object({ userId: z.string().uuid() }),
  access: { roles: access.admin },
  description:
    "Lifts a GDPR Art. 18 processing restriction on the named user and returns the account to active; operator-only, because a restricted user's own session is rejected and cannot reach this endpoint.",
  escapeHatch: {
    reason: LIFT_RESTRICTION_ESCAPE_HATCH_REASON,
  },
  handler: async (event, ctx) => {
    const targetUserId = event.payload.userId;

    const outside = await denyIfTargetOutsideAdminTenant(
      ctx.db.unsafeRaw(CHECK_TARGET_MEMBERSHIP_REASON),
      event.user,
      targetUserId,
    );
    if (outside) return outside;

    const userRow = await ctx.db.global(userTable).fetchOne<{ status: string }>({
      id: targetUserId,
    });

    if (!userRow) {
      return writeFailure(
        new UnprocessableError("user_not_found", {
          details: { userId: targetUserId },
        }),
      );
    }

    const currentStatus = userRow["status"];
    if (currentStatus !== USER_STATUS.Restricted) {
      return writeFailure(
        new UnprocessableError("not_restricted", {
          details: { currentStatus },
        }),
      );
    }

    await updateUserLifecycle(ctx.db.unsafeRaw(APPEND_LIFECYCLE_EVENT_REASON), targetUserId, {
      status: USER_STATUS.Active,
    });

    return {
      isSuccess: true as const,
      data: {
        userId: targetUserId,
        status: USER_STATUS.Active,
      },
    };
  },
});
