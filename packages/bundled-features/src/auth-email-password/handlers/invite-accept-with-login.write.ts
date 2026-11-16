// Tenant-Invite Step 2 — Branch 2 (anon user with an existing email).
//
// Flow:
//   1. User (not logged in) clicks the invite link → /invite/accept?token=...
//   2. Frontend shows a login form with the pre-filled email (delivered by
//      the invitation page via a separate lookup query, or typed by the user)
//   3. User submits email + password + token to this handler
//   4. Server: login + accept in one step:
//      a. Token → invitationId → invitation row
//      b. Login check: password against userTable for invitation.email — via
//         the same login.write.ts gates (lockout, password, email-verified,
//         account-status, MFA), not a standalone verifyPassword call
//      c. Email match (from user input) === invitation.email
//      d. Membership added in the invited tenant
//      e. Invitation → status=accepted, token deleted
//   5. Response: SessionUser + tenantId/role for auto-login (analog to
//      signup-confirm), or an mfa-challenge/mfa-setup-required if an MFA
//      gate fires — identical shape to login.write.ts (see LoginResult).
//
// Unlike signup-confirm: no new tenant is created, no new user is created —
// both already exist. The magic is the combined login+accept operation in
// one round trip.

import {
  buildSessionRoles,
  defineWriteHandler,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { sessionLocaleField, sessionTimezoneField } from "../../shared/index.ts";
// kumiko-lint-ignore cross-feature-import membership grant for a privileged cross-tenant add
import { grantInvitedMembershipRole } from "../../tenant/invited-membership.ts";
// kumiko-lint-ignore cross-feature-import global roles granted on invite accept live on the user row
import {
  grantInvitedGlobalRoles,
  parseInvitedGlobalRoles,
} from "../../user/invited-global-roles.ts";
// kumiko-lint-ignore cross-feature-import the handler verifies the invited email password against the user row, like login
import { userTable } from "../../user/schema/user.ts";
import { invalidCredentials, inviteEmailMismatch } from "../errors.ts";
import { consumeInviteToken, markInvitationAccepted } from "../invite-consumption.ts";
import { passwordSchema } from "../password-policy.ts";
import {
  AUTH_LOCKOUT_DEFAULT_DURATION_MINUTES,
  AUTH_LOCKOUT_DEFAULT_MAX_FAILED_ATTEMPTS,
} from "../web/constants.ts";
import {
  gateEnforceAccountStatus,
  gateEnforceEmailVerified,
  gateEnforceLockout,
  gateEnforceMfa,
  gateVerifyPassword,
  type LoginHandlerOptions,
  type LoginResult,
} from "./login.write.ts";

const InviteAcceptWithLoginSchema = z.object({
  token: z.string().min(1),
  email: z.email(),
  password: passwordSchema,
});

// Reuses login.write.ts's MFA branches unmodified (see LoginResult) so a
// client handles an invite-accept-with-login MFA challenge exactly like a
// regular login one. The auth-session branch stays invite-specific — it
// additionally carries tenantId/role for the invited tenant.
export type InviteAcceptWithLoginData =
  | {
      readonly kind: "auth-session";
      readonly session: SessionUser;
      readonly tenantId: TenantId;
      readonly role: string;
    }
  | Exclude<LoginResult, { readonly kind: "auth-session" }>;

export type InviteAcceptWithLoginOptions = {
  readonly mfaStatusChecker?: LoginHandlerOptions["mfaStatusChecker"];
  readonly accountLockout?: LoginHandlerOptions["accountLockout"];
  readonly strictEmailVerification?: boolean;
};

type UserAuthRow = {
  readonly id: string;
  readonly passwordHash: string | null;
  readonly timezone?: string | null;
  readonly locale?: string | null;
  readonly emailVerified?: boolean | null;
  readonly status?: string | null;
};

export function createInviteAcceptWithLoginHandler(opts: InviteAcceptWithLoginOptions = {}) {
  const strictVerification = opts.strictEmailVerification === true;
  const maxFailedAttempts =
    opts.accountLockout?.maxFailedAttempts ?? AUTH_LOCKOUT_DEFAULT_MAX_FAILED_ATTEMPTS;
  const lockoutDurationMinutes =
    opts.accountLockout?.lockoutDurationMinutes ?? AUTH_LOCKOUT_DEFAULT_DURATION_MINUTES;

  return defineWriteHandler<
    "invite-accept-with-login",
    typeof InviteAcceptWithLoginSchema,
    InviteAcceptWithLoginData
  >({
    name: "invite-accept-with-login",
    schema: InviteAcceptWithLoginSchema,
    access: { roles: ["anonymous"] },
    rateLimit: { per: "ip+handler", limit: 20, windowSeconds: 60 },
    escapeHatch: {
      grants: ["unsafeRaw"],
      reason:
        "Anonymous invite-accept has no session in the invited tenant yet — reads the pending " +
        "invitation by id (the invitee is not yet a member of the " +
        "invitation's tenant), adds the membership and accepts the invitation in the " +
        "invitation's tenant, which differs from the caller's tenant, and reads the MFA " +
        "enrollment of that tenant via the mfaStatusChecker callback.",
    },
    agent: { expose: false },
    handler: async (event, ctx) =>
      consumeInviteToken(
        ctx,
        {
          token: event.payload.token,
          handlerName: "invite-accept-with-login",
          piiReason: "auth:invite-accept-with-login",
        },
        async (invitation, dbConn) => {
          // Email match from user input (not from session — user is anon)
          if (event.payload.email.toLowerCase() !== invitation.email) {
            return inviteEmailMismatch();
          }

          // Password check against userTable, through the same gates
          // login.write.ts runs (see login-gates.test.ts for the gate contracts).
          // Email uniqueness is partial on live rows — without
          // this filter the lookup can resolve a soft-deleted row.
          const userRow = await ctx.db.global(userTable).fetchOne<UserAuthRow>({
            email: invitation.email,
            isDeleted: false,
          });
          // No enumeration risk: reaching here already required a valid, open
          // invite token plus the matching invitation email.
          if (!userRow?.passwordHash) return invalidCredentials();

          const lockoutGate = await gateEnforceLockout(ctx, userRow.id);
          if (!lockoutGate.ok) return lockoutGate.result;

          const passwordGate = await gateVerifyPassword(
            ctx,
            { id: userRow.id, passwordHash: userRow.passwordHash },
            event.payload.password,
            maxFailedAttempts,
            lockoutDurationMinutes,
          );
          if (!passwordGate.ok) return invalidCredentials();

          const emailGate = gateEnforceEmailVerified(userRow, strictVerification);
          if (!emailGate.ok) return emailGate.result;

          const statusGate = gateEnforceAccountStatus(userRow);
          if (!statusGate.ok) return statusGate.result;

          const userId = userRow.id;

          const grant = await grantInvitedMembershipRole(dbConn, {
            userId,
            tenantId: invitation.tenantId,
            role: invitation.role,
            invitation,
          });
          if (!grant.isSuccess) return grant;

          const globalGrant = await grantInvitedGlobalRoles(dbConn, {
            userId,
            globalRoles: parseInvitedGlobalRoles(invitation.globalRoles),
          });
          if (!globalGrant.isSuccess) return globalGrant;

          const updateResult = await markInvitationAccepted(dbConn, invitation);
          if (!updateResult.isSuccess) return updateResult;

          // buildSessionRoles calls stripForbiddenMembershipRoles internally —
          // a reserved role on an existing membership must never reach the session.
          const mergedRoles = buildSessionRoles(globalGrant.data.roles, grant.data.roles);

          // The MFA gate runs before the token is deleted, so a throwing check
          // leaves the link usable again; a challenge halts the session mint,
          // not the invite acceptance itself.
          const mfaGate = await gateEnforceMfa(
            ctx,
            { mfaStatusChecker: opts.mfaStatusChecker },
            userId,
            invitation.tenantId,
            mergedRoles,
          );
          if (mfaGate !== undefined) {
            return { isSuccess: true, data: mfaGate };
          }

          // SessionUser for the JWT mint in the invited tenant. Roles =
          // mergedRoles (Admin/Editor/User depending on the invite).
          const session: SessionUser = {
            id: userId,
            tenantId: invitation.tenantId,
            roles: mergedRoles,
            ...sessionTimezoneField(userRow.timezone),
            ...sessionLocaleField(userRow.locale),
          };

          return {
            isSuccess: true,
            data: {
              kind: "auth-session",
              session,
              tenantId: invitation.tenantId,
              role: invitation.role,
            },
          };
        },
      ),
  });
}
