import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createSystemUser, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { tenantMembershipsTable } from "../../tenant";
import { USER_STATUS, userTable } from "../../user";
import { isAdminActor, isSystemAdminActor } from "../lib/is-admin-actor";
import { updateUserLifecycle } from "../lib/update-user-lifecycle";

// POST /api/user/restrict (S2.U6) — DSGVO Art. 18 Account-Freeze.
// Flippt status=Active → Restricted und revoked alle live sessions
// des Users via cross-feature ctx.writeAs(sessions.revokeAllForUser).
//
// Plan-Doc-Verhalten ("Schreib-API geblockt"):
//   - Login geblockt: login.write.ts checked status=Restricted (Atom 3).
//   - Active sessions: revoked durch cross-feature-call (sessions-feature
//     muss gemountet sein). App-Author ohne sessions-feature kriegt einen
//     Boot-Resolver-Error via r.usesApi("sessions.revokeAllForUser").
//
// Self-service by default (userId omitted → event.user.id). An admin can
// also target someone else's account — needed once a user is already
// Restricted, since their own session is then unconditionally rejected by
// sessionChecker and they can no longer call this (or any) endpoint
// themselves; only an operator path reaches it at that point.
//
// Tenant scope: `isAdminActor` accepts access.admin, which includes
// TenantAdmin — tenant-scoped, even though the User-entity lookup below
// uses `ctx.db.raw` (bypasses the auto-tenant-filter, same as
// lift-restriction.write.ts — User status is intentionally global, see
// user-data-rights.md "Cross-Tenant-Semantik"). Without a membership
// check, a TenantAdmin from tenant A could restrict/unrestrict a user who
// has never been a member of tenant A. Only SystemAdmin (platform-wide)
// skips the check; TenantAdmin/Admin must have an active membership in
// the target's own tenantId.
//
// State-Transitions:
//   Active → Restricted        ✓ (dieser Handler)
//   Restricted → Restricted    ✗ 422 already_restricted (Idempotenz-Guard)
//   DeletionRequested → ...    ✗ 422 user_not_in_active_state
//   Deleted → ...              ✗ 422 user_not_in_active_state
export const restrictAccountWrite = defineWriteHandler({
  name: "restrict-account",
  schema: z.object({ userId: z.string().optional() }),
  access: { openToAll: true },
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
      // Same cross-tenant guard as lift-restriction.write.ts: only
      // SystemAdmin (platform-wide) may target a user without an active
      // membership in the caller's own tenant. Without this, a TenantAdmin
      // from tenant A could restrict — and force-revoke the sessions of —
      // a user who has never been a member of tenant A.
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
    }

    // ctx.db.raw weil User-Entity tenant-agnostisch ist (analog
    // request-deletion.write.ts Cross-Tenant-Section).
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

    const currentStatus = userRow.status;
    if (currentStatus === USER_STATUS.Restricted) {
      return writeFailure(
        new UnprocessableError("already_restricted", {
          details: { reason: "already_restricted", currentStatus },
        }),
      );
    }
    if (currentStatus !== USER_STATUS.Active) {
      return writeFailure(
        new UnprocessableError("user_not_in_active_state", {
          details: { reason: "user_not_in_active_state", currentStatus },
        }),
      );
    }

    await updateUserLifecycle(ctx.db.raw, targetUserId, { status: USER_STATUS.Restricted });

    // Cross-Feature: alle live sessions revoken — sonst koennte der User
    // mit existierendem JWT bis zur Token-Expiry weiter schreiben.
    // ctx.writeAs(systemUser, ...) damit der privileged-Handler die
    // System-User-Roles im access-gate hat.
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
