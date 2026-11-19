// Tenant invitation — logged-in user accepts.
//
// The user is signed in to some tenant and clicks the Accept link.
// Server:
//   1. Token → invitationId (Redis)
//   2. Burn (single-use)
//   3. Load the invitation row from the database
//   4. Email match: invitation.email === user.email (otherwise inviteEmailMismatch)
//   5+6. grantInvitedMembershipRole: create the membership, or add the
//      invited role to an existing one (add-only)
//   7. Invitation row → status=accepted
//   8. Delete Redis keys (the burn key remains for replay protection)
//
// This is the classic "shared workspace with a logged-in session" flow.
// Branch 2 (anonymous + existing email) and Branch 3 (anonymous + new
// email) are handled separately.

import { defineWriteHandler, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { decryptStoredPii } from "../../shared/index.ts";
// kumiko-lint-ignore cross-feature-import membership grant for a privileged cross-tenant add (like provisionSignupAccount)
import { grantInvitedMembershipRole } from "../../tenant/invited-membership.ts";
// kumiko-lint-ignore cross-feature-import global roles granted on invite accept live on the user row
import {
  grantInvitedGlobalRoles,
  parseInvitedGlobalRoles,
} from "../../user/invited-global-roles.ts";
// kumiko-lint-ignore cross-feature-import the auth handler reads the user row for the email match
import { userTable } from "../../user/schema/user.ts";
import { inviteEmailMismatch } from "../errors.ts";
import { consumeInviteToken, markInvitationAccepted } from "../invite-consumption.ts";

const InviteAcceptSchema = z.object({
  token: z.string().min(1),
});

export type InviteAcceptData = {
  readonly kind: "invite-accepted";
  readonly tenantId: TenantId;
  readonly role: string;
  readonly alreadyMember: boolean;
};

type UserEmailRow = { readonly email: string };

const INVITE_ACCEPT_ESCAPE_HATCH_REASON =
  "reads the pending invitation by id; the invitee is not yet a member of the invitation's tenant. Adds the membership and accepts the invitation in the invitation's tenant, which differs from the caller's tenant.";

export function createInviteAcceptHandler() {
  return defineWriteHandler<"invite-accept", typeof InviteAcceptSchema, InviteAcceptData>({
    name: "invite-accept",
    schema: InviteAcceptSchema,
    // openToAll: any authenticated user (Branch 1). Branch 2+3 (anon) live
    // in the sibling invite-accept-with-login / invite-signup-complete
    // handlers, which declare roles: ["anonymous"] instead.
    access: {
      openToAll: {
        reason:
          "any signed-in user may accept an invitation; the token identifies the pending " +
          "invitation and its tenant, and the handler verifies the caller's own email matches " +
          "the invitation before adding membership",
      },
    },
    agent: { expose: false },
    escapeHatch: {
      grants: ["unsafeRaw"],
      reason: INVITE_ACCEPT_ESCAPE_HATCH_REASON,
    },
    handler: async (event, ctx) =>
      consumeInviteToken(
        ctx,
        {
          token: event.payload.token,
          handlerName: "invite-accept",
          piiReason: "auth:invite-accept",
        },
        async (invitation, dbConn) => {
          // Email match: the user must match the invited email.
          // Otherwise, anyone with access to the invitee's email could add
          // their own account to the tenant.
          const userRow = await ctx.db.global(userTable).fetchOne<UserEmailRow>({
            id: event.user.id,
          });
          const userEmail = userRow?.email
            ? await decryptStoredPii(userRow.email, "email", "auth:invite-accept")
            : undefined;
          if (!userRow || !userEmail || userEmail.toLowerCase() !== invitation.email) {
            return inviteEmailMismatch();
          }

          // Executor instead of dispatcher.writeAs(addMember): addMember only
          // accepts SystemAdmin, createSystemUser carries "system".
          const grant = await grantInvitedMembershipRole(dbConn, {
            userId: event.user.id,
            tenantId: invitation.tenantId,
            role: invitation.role,
            invitation,
          });
          if (!grant.isSuccess) return grant;

          const globalGrant = await grantInvitedGlobalRoles(dbConn, {
            userId: event.user.id,
            globalRoles: parseInvitedGlobalRoles(invitation.globalRoles),
          });
          if (!globalGrant.isSuccess) return globalGrant;

          const updateResult = await markInvitationAccepted(dbConn, invitation);
          if (!updateResult.isSuccess) return updateResult;

          return {
            isSuccess: true,
            data: {
              kind: "invite-accepted",
              tenantId: invitation.tenantId,
              role: invitation.role,
              alreadyMember: grant.data.alreadyMember,
            },
          };
        },
      ),
  });
}
