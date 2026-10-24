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

import {
  createEventStoreExecutor,
  createTenantDb,
  fetchOne,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineWriteHandler,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { decryptStoredPii } from "../../shared/index.ts";
// kumiko-lint-ignore cross-feature-import the invite flow lives in auth-email-password (Magic-Link), while the DB-row owner is a tenant feature
import {
  INVITATION_STATUS,
  tenantInvitationEntity,
  tenantInvitationsTable,
} from "../../tenant/invitation-table.ts";
// kumiko-lint-ignore cross-feature-import membership grant for a privileged cross-tenant add (like provisionSignupAccount)
import { grantInvitedMembershipRole } from "../../tenant/invited-membership.ts";
// kumiko-lint-ignore cross-feature-import global roles granted on invite accept live on the user row
import {
  grantInvitedGlobalRoles,
  parseInvitedGlobalRoles,
} from "../../user/invited-global-roles.ts";
// kumiko-lint-ignore cross-feature-import the auth handler reads the user row for the email match
import { userTable } from "../../user/schema/user.ts";
import { invalidInviteToken, inviteEmailMismatch } from "../errors.ts";
import {
  burnInviteToken,
  deleteInviteToken,
  getInvitationIdForToken,
  unburnInviteToken,
} from "../invite-token-store.ts";

const InviteAcceptSchema = z.object({
  token: z.string().min(1),
});

export type InviteAcceptData = {
  readonly kind: "invite-accepted";
  readonly tenantId: TenantId;
  readonly role: string;
  readonly alreadyMember: boolean;
};

const invitationExecutor = createEventStoreExecutor(
  tenantInvitationsTable,
  tenantInvitationEntity,
  { entityName: "tenant-invitation" },
);

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
    // kumiko-lint-ignore complexity-budget invite branches (auth/anon/burn) stay in one handler
    handler: async (event, ctx) => {
      if (!ctx.redis) {
        return writeFailure(
          new InternalError({ message: "invite-accept requires ctx.redis for token consumption" }),
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
        readonly globalRoles: unknown;
        readonly version: number;
        readonly membershipVersion: number | null;
        readonly insertedAt: Temporal.Instant;
        readonly modifiedAt: Temporal.Instant | null;
      };
      type UserEmailRow = { readonly email: string };

      let committed = false;
      try {
        const invitation = await fetchOne<InvitationRow>(
          ctx.db.unsafeRaw(),
          tenantInvitationsTable,
          { id: invitationId },
        );
        if (!invitation || invitation.status !== INVITATION_STATUS.pending)
          return invalidInviteToken();

        const invitationTenantId = invitation.tenantId;
        const invitationEmail = await decryptStoredPii(
          invitation.email,
          "email",
          "auth:invite-accept",
        );
        const invitationRole = invitation.role;
        const invitationVersion = invitation.version;

        // Email match: the user must match the invited email.
        // Otherwise, anyone with access to the invitee's email could add
        // their own account to the tenant.
        const userRow = await ctx.db.global(userTable).fetchOne<UserEmailRow>({
          id: event.user.id,
        });
        const userEmail = userRow?.email
          ? await decryptStoredPii(userRow.email, "email", "auth:invite-accept")
          : undefined;
        if (!userRow || !userEmail || userEmail.toLowerCase() !== invitationEmail) {
          return inviteEmailMismatch();
        }

        // Executor instead of dispatcher.writeAs(addMember): addMember only
        // accepts SystemAdmin, createSystemUser carries "system".
        const dbConn = ctx.db.unsafeRaw();
        const grant = await grantInvitedMembershipRole(dbConn, {
          userId: event.user.id,
          tenantId: invitationTenantId,
          role: invitationRole,
          invitation,
        });
        if (!grant.isSuccess) return grant;
        const { alreadyMember } = grant.data;

        const globalGrant = await grantInvitedGlobalRoles(dbConn, {
          userId: event.user.id,
          globalRoles: parseInvitedGlobalRoles(invitation.globalRoles),
        });
        if (!globalGrant.isSuccess) return globalGrant;

        // Invitation status → accepted via event-store-executor.
        // Tenant scoping: ctx.db is scoped to event.user.tenantId
        // (not the invitation tenant). Build a TenantDb for the
        // invitation tenant so the executor can find the row.
        const invitationTdb = createTenantDb({
          db: dbConn,
          tenantId: invitationTenantId,
          mode: "system",
          reason:
            "invitation tenant differs from the caller's tenant, the accept step updates the invitation row there",
        });
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

        committed = true;
        return {
          isSuccess: true,
          data: {
            kind: "invite-accepted",
            tenantId: invitationTenantId,
            role: invitationRole,
            alreadyMember,
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
