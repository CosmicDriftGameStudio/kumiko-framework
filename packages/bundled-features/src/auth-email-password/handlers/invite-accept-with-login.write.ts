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

import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  buildSessionRoles,
  createSystemUser,
  defineWriteHandler,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { decryptStoredPii, sessionLocaleField, sessionTimezoneField } from "../../shared";
// kumiko-lint-ignore cross-feature-import invite-flow
import {
  INVITATION_STATUS,
  tenantInvitationEntity,
  tenantInvitationsTable,
} from "../../tenant/invitation-table";
// kumiko-lint-ignore cross-feature-import membership-seed-helper for a privileged cross-tenant add
import { seedTenantMembership } from "../../tenant/seeding";
// kumiko-lint-ignore cross-feature-import login-style password-check
import { userTable } from "../../user/schema/user";
import {
  AUTH_LOCKOUT_DEFAULT_DURATION_MINUTES,
  AUTH_LOCKOUT_DEFAULT_MAX_FAILED_ATTEMPTS,
} from "../constants";
import { invalidInviteToken, inviteEmailMismatch } from "../errors";
import {
  burnInviteToken,
  deleteInviteToken,
  getInvitationIdForToken,
  unburnInviteToken,
} from "../invite-token-store";
import { passwordSchema } from "../password-policy";
import {
  gateEnforceAccountStatus,
  gateEnforceEmailVerified,
  gateEnforceLockout,
  gateEnforceMfa,
  gateVerifyPassword,
  type LoginHandlerOptions,
  type LoginResult,
} from "./login.write";

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

const invitationExecutor = createEventStoreExecutor(
  tenantInvitationsTable,
  tenantInvitationEntity,
  { entityName: "tenant-invitation" },
);

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
    access: { roles: ["all"] },
    // kumiko-lint-ignore complexity-budget reuses login.write.ts's gate chain (lockout/password/email/status/membership/mfa) plus invite-specific branches (email match, already-member check, invitation update, unburn-on-failure) — splitting would scatter gate order across functions without reducing risk
    handler: async (event, ctx) => {
      if (!ctx.redis) {
        return writeFailure(
          new InternalError({ message: "invite-accept-with-login requires ctx.redis" }),
        );
      }

      const invitationId = await getInvitationIdForToken(ctx.redis, event.payload.token);
      if (!invitationId) return invalidInviteToken();

      const burn = await burnInviteToken(ctx.redis, event.payload.token);
      if (burn === "already-used") return invalidInviteToken();

      type InvitationRow = {
        readonly status: string;
        readonly tenantId: TenantId;
        readonly email: string;
        readonly role: string;
        readonly version: number;
      };
      type UserAuthRow = {
        readonly id: string;
        readonly passwordHash: string | null;
        readonly timezone?: string | null;
        readonly locale?: string | null;
        readonly emailVerified?: boolean | null;
        readonly status?: string | null;
      };

      let committed = false;
      try {
        const invitation = await fetchOne<InvitationRow>(ctx.db.raw, tenantInvitationsTable, {
          id: invitationId,
        });
        if (!invitation || invitation.status !== INVITATION_STATUS.pending)
          return invalidInviteToken();

        const invitationTenantId = invitation.tenantId;
        const invitationEmail = await decryptStoredPii(
          invitation.email,
          "email",
          "auth:invite-accept-with-login",
        );
        const invitationRole = invitation.role;
        const invitationVersion = invitation.version;

        // Email match from user input (not from session — user is anon)
        if (event.payload.email.toLowerCase() !== invitationEmail) {
          return inviteEmailMismatch();
        }

        // Password check against userTable, through the same gates
        // login.write.ts runs (see login-gates.test.ts for the gate contracts).
        const userRow = await fetchOne<UserAuthRow>(ctx.db.raw, userTable, {
          email: invitationEmail,
        });
        if (!userRow?.passwordHash) return invalidInviteToken();

        const lockoutGate = await gateEnforceLockout(ctx, userRow.id);
        if (!lockoutGate.ok) return lockoutGate.result;

        // Wrong password still collapses to invalidInviteToken (existing
        // anti-enum contract for this endpoint) — gateVerifyPassword runs
        // regardless, for its failed-attempt recording side effect.
        const passwordGate = await gateVerifyPassword(
          ctx,
          { id: userRow.id, passwordHash: userRow.passwordHash },
          event.payload.password,
          maxFailedAttempts,
          lockoutDurationMinutes,
        );
        if (!passwordGate.ok) return invalidInviteToken();

        const emailGate = gateEnforceEmailVerified(userRow, strictVerification);
        if (!emailGate.ok) return emailGate.result;

        const statusGate = gateEnforceAccountStatus(userRow);
        if (!statusGate.ok) return statusGate.result;

        const userId = userRow.id;

        // Already-member check (idempotent)
        const memberships = (await ctx.queryAs(
          createSystemUser(invitationTenantId),
          "tenant:query:memberships",
          { userId },
        )) as Array<{ tenantId: string }>; // @cast-boundary db-row
        const alreadyMember = memberships.some((m) => m.tenantId === invitationTenantId);

        const dbConn = ctx.db.raw;

        if (!alreadyMember) {
          await seedTenantMembership(dbConn, {
            userId,
            tenantId: invitationTenantId,
            roles: [invitationRole],
          });
        }

        // Invitation → accepted: TenantDb for the invitation's tenant.
        const invitationTdb = createTenantDb(dbConn, invitationTenantId, "system");
        const updateResult = await invitationExecutor.update(
          {
            id: invitationId,
            version: invitationVersion,
            changes: { status: INVITATION_STATUS.accepted },
          },
          createSystemUser(invitationTenantId),
          invitationTdb,
        );
        if (!updateResult.isSuccess) return updateResult;

        await deleteInviteToken(ctx.redis, { invitationId, token: event.payload.token });

        // buildSessionRoles calls stripForbiddenMembershipRoles internally —
        // a reserved role on the invitation itself must never reach the session.
        const mergedRoles = buildSessionRoles([], [invitationRole]);

        // MFA gate runs after membership is granted (mirrors login.write.ts's
        // own order: membership resolution before MFA) — a challenge halts
        // the session mint, not the invite acceptance itself.
        const mfaGate = await gateEnforceMfa(
          ctx,
          { mfaStatusChecker: opts.mfaStatusChecker },
          userId,
          invitationTenantId,
          mergedRoles,
        );
        if (mfaGate !== undefined) {
          committed = true;
          return { isSuccess: true, data: mfaGate };
        }

        // SessionUser for the JWT mint in the invited tenant. Roles =
        // mergedRoles (Admin/Editor/User depending on the invite).
        const session: SessionUser = {
          id: userId,
          tenantId: invitationTenantId,
          roles: mergedRoles,
          ...sessionTimezoneField(userRow.timezone),
          ...sessionLocaleField(userRow.locale),
        };

        committed = true;
        return {
          isSuccess: true,
          data: {
            kind: "auth-session",
            session,
            tenantId: invitationTenantId,
            role: invitationRole,
          },
        };
      } finally {
        if (!committed && ctx.redis) {
          await unburnInviteToken(ctx.redis, event.payload.token);
        }
      }
    },
  });
}
