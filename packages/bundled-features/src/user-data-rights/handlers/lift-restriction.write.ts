import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { tenantMembershipsTable } from "../../tenant";
import { USER_STATUS, userTable } from "../../user";
import { isSystemAdminActor } from "../lib/is-admin-actor";
import { updateUserLifecycle } from "../lib/update-user-lifecycle";

// POST /api/user/lift-restriction (S2.U6) — DSGVO Art. 18 Reverse.
//
// Operator-only. A Restricted user's own session is unconditionally
// rejected by sessionChecker (BLOCKED_STATUSES) the moment their status
// flips — their JWT/login can't reach this or any other authenticated
// endpoint. There is no self-service path today, so lifting a restriction
// always targets someone else's account by id.
//
// Tenant scope: `access.admin` includes TenantAdmin, which is tenant-
// scoped even though the User-entity lookup below uses `ctx.db.raw`
// (bypasses the auto-tenant-filter, same as restrict-account.write.ts —
// User status is intentionally global, see user-data-rights.md
// "Cross-Tenant-Semantik"). Without a membership check, a TenantAdmin
// from tenant A could unrestrict/reactivate a user who has never been a
// member of tenant A. Only SystemAdmin (platform-wide) skips the check;
// TenantAdmin/Admin must have an active membership in the target's own
// tenantId.
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
  handler: async (event, ctx) => {
    const targetUserId = event.payload.userId;

    if (!isSystemAdminActor(event.user)) {
      const membership = await fetchOne(ctx.db.raw, tenantMembershipsTable, {
        userId: targetUserId,
        tenantId: event.user.tenantId,
      });
      if (!membership) {
        return writeFailure(
          new AccessDeniedError({
            details: { reason: "target_user_not_in_admin_tenant" },
          }),
        );
      }
    }

    const userRow = await fetchOne<{ status: string }>(ctx.db.raw, userTable, {
      id: targetUserId,
    });

    if (!userRow) {
      return writeFailure(
        new UnprocessableError("user_not_found", {
          details: { reason: "user_not_found", userId: targetUserId },
        }),
      );
    }

    const currentStatus = userRow["status"];
    if (currentStatus !== USER_STATUS.Restricted) {
      return writeFailure(
        new UnprocessableError("not_restricted", {
          details: { reason: "not_restricted", currentStatus },
        }),
      );
    }

    await updateUserLifecycle(ctx.db.raw, targetUserId, { status: USER_STATUS.Active });

    return {
      isSuccess: true as const,
      data: {
        userId: targetUserId,
        status: USER_STATUS.Active,
      },
    };
  },
});
