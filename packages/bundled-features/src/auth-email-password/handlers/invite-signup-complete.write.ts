// Tenant-Invite Step 2 — Branch 3 (anonymous user, email NOT registered).
//
// Unlike signup-confirm, no new tenant is created. The tenant already
// exists in the invitation row; only the user and membership are created.
//
// Flow:
//   1. User clicks the invite link → /invite/signup?token=...
//   2. The frontend shows the password form (the email comes from the
//      invitation, not user input, so an email mismatch is impossible)
//   3. User submits the password and token
//   4. Server:
//      a. Token → invitationId → invitation row
//      b. User-existence check: invitation.email must NOT exist in userTable
//         (otherwise Branch 2 or Branch 1 must be used)
//      c. Create the user (emailVerified=true because of the magic link)
//      d. Add membership to the invited tenant
//      e. Mark the invitation accepted and delete the token
//   5. Response: SessionUser + tenantId for automatic login

import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import {
  buildSessionRoles,
  defineWriteHandler,
  type HandlerContext,
  type SessionUser,
  type TenantId,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { registrationLocaleFromRequest } from "../../shared/index.ts";
// kumiko-lint-ignore cross-feature-import reserved-role check owned by tenant-feature
import {
  findForbiddenMembershipRole,
  reservedMembershipRoleError,
} from "../../tenant/membership-roles.ts";
// kumiko-lint-ignore cross-feature-import membership-seed-helper for privileged cross-tenant addition
import { seedTenantMembership } from "../../tenant/seeding.ts";
// kumiko-lint-ignore cross-feature-import the handler rejects an invitation whose email already has a user row
import { userTable } from "../../user/schema/user.ts";
import { invalidInviteToken } from "../errors.ts";
import {
  consumeInviteToken,
  markInvitationAccepted,
  type PendingInvitation,
} from "../invite-consumption.ts";
import { passwordSchema } from "../password-policy.ts";
import { seedUserWithPassword } from "../seeding.ts";
import { gateEnforceMfa, type LoginHandlerOptions, type LoginResult } from "./login.write.ts";

const InviteSignupCompleteSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export type InviteSignupCompleteData =
  | {
      readonly kind: "auth-session";
      readonly session: SessionUser;
      readonly tenantId: TenantId;
      readonly role: string;
    }
  | Exclude<LoginResult, { readonly kind: "auth-session" }>;

export type InviteSignupCompleteOptions = Pick<LoginHandlerOptions, "mfaStatusChecker">;

const INVITE_SIGNUP_COMPLETE_ESCAPE_HATCH_REASON =
  "reads the pending invitation by id; the invitee is not yet a member of the invitation's tenant. Creates the user and adds the membership and accepts the invitation in the invitation's tenant, before any caller tenant context exists.";

export function createInviteSignupCompleteHandler(opts: InviteSignupCompleteOptions = {}) {
  return defineWriteHandler<
    "invite-signup-complete",
    typeof InviteSignupCompleteSchema,
    InviteSignupCompleteData
  >({
    name: "invite-signup-complete",
    schema: InviteSignupCompleteSchema,
    access: { roles: ["anonymous"], personalData: "public-intake" },
    rateLimit: { per: "ip+handler", limit: 20, windowSeconds: 60 },
    agent: { expose: false },
    escapeHatch: {
      grants: ["unsafeRaw", "globalWrites"],
      reason: INVITE_SIGNUP_COMPLETE_ESCAPE_HATCH_REASON,
    },
    handler: async (event, ctx) =>
      consumeInviteToken(
        ctx,
        {
          token: event.payload.token,
          handlerName: "invite-signup-complete",
          piiReason: "auth:invite-signup-complete",
        },
        (invitation, dbConn) =>
          acceptInvitationAndCreateUser(ctx, opts, invitation, dbConn, event.payload.password),
      ),
  });
}

async function acceptInvitationAndCreateUser(
  ctx: HandlerContext,
  opts: InviteSignupCompleteOptions,
  invitation: PendingInvitation,
  dbRunner: DbRunner,
  password: string,
): Promise<WriteResult<InviteSignupCompleteData>> {
  const invitationTenantId = invitation.tenantId;
  const invitationEmail = invitation.email;
  const invitationRole = invitation.role;

  // If the email is already registered, the user must use Branch 2
  // (acceptWithLogin). This flow explicitly requires a new email;
  // otherwise there would be two ways to set a password for the same user.
  // Email uniqueness is partial on live rows — without this filter,
  // the lookup can resolve a soft-deleted row.
  const existingUser = await ctx.db.global(userTable).fetchOne({
    email: invitationEmail,
    isDeleted: false,
  });
  if (existingUser) return invalidInviteToken();

  // Create the user through seedUserWithPassword so the magic-link flow
  // records emailVerified=true.
  const registrationLocale = registrationLocaleFromRequest();
  const { id: userId } = await seedUserWithPassword(dbRunner, {
    email: invitationEmail,
    password: password,
    displayName: invitationEmail.split("@")[0] ?? invitationEmail,
    emailVerified: true,
    ...registrationLocale,
  });

  // The seed helper bypasses addMember's access check because
  // createSystemUser does not match ["SystemAdmin"].
  const forbiddenInviteRole = findForbiddenMembershipRole([invitationRole]);
  if (forbiddenInviteRole !== undefined) {
    return writeFailure(reservedMembershipRoleError(forbiddenInviteRole));
  }
  const membership = await seedTenantMembership(dbRunner, {
    userId,
    tenantId: invitationTenantId,
    roles: [invitationRole],
  });
  if (membership.rowMissing) {
    ctx.obs.log.warn("invite signup: membership stream exists but its row is missing", {
      tenantId: invitationTenantId,
      userId,
    });
  }

  const updateResult = await markInvitationAccepted(dbRunner, invitation);
  if (!updateResult.isSuccess) return updateResult;

  // buildSessionRoles calls stripForbiddenMembershipRoles internally —
  // a reserved role on the invitation itself must never reach the session.
  const mergedRoles = buildSessionRoles([], [invitationRole]);

  // Same gate as invite-accept-with-login: the account exists after this
  // call, but an MFA-gated role gets the MFA step instead of a session.
  // consumeInviteToken deletes the token only after this gate, so a throwing
  // check leaves the link retryable.
  const mfaGate = await gateEnforceMfa(
    ctx,
    { mfaStatusChecker: opts.mfaStatusChecker },
    userId,
    invitationTenantId,
    mergedRoles,
  );
  if (mfaGate !== undefined) {
    return { isSuccess: true, data: mfaGate };
  }

  const session: SessionUser = {
    id: userId,
    tenantId: invitationTenantId,
    roles: mergedRoles,
    ...registrationLocale,
  };

  return {
    isSuccess: true,
    data: {
      kind: "auth-session",
      session,
      tenantId: invitationTenantId,
      role: invitationRole,
    },
  };
}
