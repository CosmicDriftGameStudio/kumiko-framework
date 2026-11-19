import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { USER_STATUS, userTable } from "../../user/index.ts";
import { denyIfTargetBeyondAdminReach } from "../lib/deny-if-target-beyond-admin-reach.ts";
import { updateUserLifecycle } from "../lib/update-user-lifecycle.ts";

const LIFT_RESTRICTION_ESCAPE_HATCH_REASON =
  "reads the target user's memberships and roles across tenants via crossTenantReads to check them against the admin's reach; the user lifecycle status change is appended on the SYSTEM_TENANT_ID user stream via the raw DbRunner, outside the admin's own tenant scope.";

// POST /api/user/lift-restriction — GDPR Art. 18 Reverse.
//
// Operator-only. A Restricted user's own session is unconditionally
// rejected by sessionChecker (BLOCKED_STATUSES) the moment their status
// flips — their JWT/login can't reach this or any other authenticated
// endpoint. There is no self-service path today, so lifting a restriction
// always targets someone else's account by id.
//
// Admin reach: `access.admin` includes TenantAdmin (tenant-scoped) even though the User-entity is
// global — see user-data-rights.md "Cross-Tenant Semantics". Only SystemAdmin (platform-wide) skips
// the check; otherwise the target must be a member of the acting admin's `event.user.tenantId`
// only and must not hold a role above the admin's rank there (row existence only — no
// active-status field).
//
// State-Transitions:
//   Restricted → Active        ✓
//   Active → ...               ✗ 422 not_restricted (Idempotency Guard)
//   DeletionRequested → ...    ✗ 422 not_restricted
//   Deleted → ...              ✗ 422 not_restricted
export const liftRestrictionWrite = defineWriteHandler({
  name: "lift-restriction",
  schema: z.object({ userId: z.string().uuid() }),
  access: { roles: access.admin },
  description:
    "Lifts a GDPR Art. 18 processing restriction on the named user and returns the account to active; operator-only, because a restricted user's own session is rejected and cannot reach this endpoint.",
  escapeHatch: {
    grants: ["crossTenantReads", "unsafeRaw"],
    reason: LIFT_RESTRICTION_ESCAPE_HATCH_REASON,
  },
  handler: async (event, ctx) => {
    const targetUserId = event.payload.userId;

    const outside = await denyIfTargetBeyondAdminReach(
      ctx.crossTenantReads,
      event.user,
      targetUserId,
      ctx.registry.features.has("user"),
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

    await updateUserLifecycle(ctx.db.unsafeRawAllTenants(), targetUserId, {
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
