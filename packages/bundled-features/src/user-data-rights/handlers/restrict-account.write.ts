import { createSystemUser, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { USER_STATUS, userTable } from "../../user/index.ts";
import { denyIfTargetOutsideAdminTenant } from "../lib/deny-if-target-outside-admin-tenant.ts";
import { isAdminActor } from "../lib/is-admin-actor.ts";
import { updateUserLifecycle } from "../lib/update-user-lifecycle.ts";

// POST /api/user/restrict — GDPR Art. 18 account freeze.
// Flips status=Active → Restricted and revokes all live sessions
// for the user via cross-feature ctx.writeAs(sessions.revokeAllForUser).
//
// Write API behaviour:
//   - Login is blocked: login.write.ts checks status=Restricted (Atom 3).
//   - Active sessions are revoked through a cross-feature call (the
//     sessions feature must be mounted). An app author without the
//     sessions feature gets a boot resolver error via
//     r.usesApi("sessions.revokeAllForUser").
//
// Self-service by default (userId omitted → event.user.id). An admin can
// also target someone else's account — needed once a user is already
// Restricted, since their own session is then unconditionally rejected by
// sessionChecker and they can no longer call this (or any) endpoint
// themselves; only an operator path reaches it at that point.
//
// Tenant scope: `isAdminActor` accepts access.admin, which includes TenantAdmin
// (tenant-scoped) even though the User entity is global — see user-data-rights.md
// "Cross-Tenant-Semantik". Without a membership check, a TenantAdmin from tenant A
// could restrict or unrestrict a user who has never been a member of tenant A.
// Only SystemAdmin (platform-wide) skips the check; the target must have a
// membership row in the acting admin's `event.user.tenantId` (row existence only —
// no active-status field).
//
// State transitions:
//   Active → Restricted        ✓ (this handler)
//   Restricted → Restricted    ✗ 422 already_restricted (idempotency guard)
//   DeletionRequested → ...    ✗ 422 user_not_in_active_state
//   Deleted → ...              ✗ 422 user_not_in_active_state
export const restrictAccountWrite = defineWriteHandler({
  name: "restrict-account",
  schema: z.object({ userId: z.string().uuid().optional() }),
  access: {
    openToAll: {
      reason:
        "each signed-in user may restrict only their own account by default; targeting " +
        "another userId additionally requires isAdminActor(event.user) and a membership " +
        "row for the target in the admin's own tenant, both checked in the handler body",
    },
  },
  escapeHatch: {
    reason:
      "Revokes all live sessions of the (possibly self-)restricted user via ctx.writeAs(SYSTEM, " +
      "sessions:write:user-session:revoke-all-for-user) — that handler's own access gate needs " +
      "privileged roles the acting caller doesn't necessarily have. It also checks the target " +
      "user's membership in the admin's tenant and appends the user lifecycle status change on " +
      "the SYSTEM_TENANT_ID user stream, both via DbRunner helpers.",
  },
  description:
    "Freezes an account under GDPR Art. 18 by flipping it to restricted and revoking all of its live sessions, locking the user out until an admin calls lift-restriction; targets the caller by default, an admin may name another userId.",
  agent: { risk: "high" },
  handler: async (event, ctx) => {
    const targetUserId = event.payload.userId ?? event.user.id;
    if (targetUserId !== event.user.id) {
      if (!isAdminActor(event.user)) {
        return writeFailure(
          new AccessDeniedError({
            details: { reason: "admin_required_for_other_user" },
          }),
        );
      }
      const outside = await denyIfTargetOutsideAdminTenant(
        ctx.db.unsafeRaw(),
        event.user,
        targetUserId,
      );
      if (outside) return outside;
    }

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

    const currentStatus = userRow.status;
    if (currentStatus === USER_STATUS.Restricted) {
      return writeFailure(
        new UnprocessableError("already_restricted", {
          details: { currentStatus },
        }),
      );
    }
    if (currentStatus !== USER_STATUS.Active) {
      return writeFailure(
        new UnprocessableError("user_not_in_active_state", {
          details: { currentStatus },
        }),
      );
    }

    await updateUserLifecycle(ctx.db.unsafeRaw(), targetUserId, { status: USER_STATUS.Restricted });

    // Cross-feature: all live sessions are revoked; otherwise the user could
    // continue writing with an existing JWT until token expiry.
    // ctx.writeAs(systemUser, ...) gives the privileged handler the
    // System user roles required by its access gate.
    const systemUser = createSystemUser(event.user.tenantId);
    await ctx.writeAs(systemUser, "sessions:write:user-session:revoke-all-for-user", {
      userId: targetUserId,
    });

    return {
      isSuccess: true as const,
      data: {
        userId: targetUserId,
        status: USER_STATUS.Restricted,
      },
    };
  },
});
