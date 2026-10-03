// Tenant-Invite Step 2 — Branch 1 (logged-in user accepts).
//
// User ist eingeloggt (in irgendeinem Tenant), klickt Accept-Link.
// Server:
//   1. Token → invitationId (Redis)
//   2. Burn (single-use)
//   3. Invitation-Row aus DB
//   4. Email-Match: invitation.email === user.email (sonst inviteEmailMismatch)
//   5+6. grantInvitedMembershipRole: create the membership, or add the
//      invited role to an existing one (add-only)
//   7. Invitation-Row → status=accepted
//   8. Redis-Keys löschen (Burn-Key bleibt für Replay-Schutz)
//
// Branch 1 ist der klassische "shared workspace bei eingeloggter
// Session"-Flow. Branch 2 (anon + existing email) und Branch 3 (anon +
// new email) kommen als separate Handler.

import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineWriteHandler,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import type { Temporal } from "temporal-polyfill";
import * as z from "zod";
import { decryptStoredPii } from "../../shared/index.js";
// kumiko-lint-ignore cross-feature-import invite-flow lebt in auth-email-password (Magic-Link), DB-row-owner ist tenant-feature
import {
  INVITATION_STATUS,
  tenantInvitationEntity,
  tenantInvitationsTable,
} from "../../tenant/invitation-table.js";
// kumiko-lint-ignore cross-feature-import membership grant for a privileged cross-tenant add (like provisionSignupAccount)
import { grantInvitedMembershipRole, invitationIssuedAt } from "../../tenant/invited-membership.js";
// kumiko-lint-ignore cross-feature-import global roles granted on invite accept live on the user row
import {
  grantInvitedGlobalRoles,
  parseInvitedGlobalRoles,
} from "../../user/invited-global-roles.js";
// kumiko-lint-ignore cross-feature-import auth handler reads user-row für email-match
import { userTable } from "../../user/schema/user.js";
import { invalidInviteToken, inviteEmailMismatch } from "../errors.js";
import {
  burnInviteToken,
  deleteInviteToken,
  getInvitationIdForToken,
  unburnInviteToken,
} from "../invite-token-store.js";

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

        // Email-Match: User muss mit der eingeladenen Email matchen.
        // Sonst kann ein Angreifer mit Zugriff zur invitee-Mail seinen
        // eigenen Account dem Tenant zuschlagen.
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
          invitationIssuedAt: invitationIssuedAt(invitation),
        });
        if (!grant.isSuccess) return grant;
        const { alreadyMember } = grant.data;

        const globalGrant = await grantInvitedGlobalRoles(dbConn, {
          userId: event.user.id,
          globalRoles: parseInvitedGlobalRoles(invitation.globalRoles),
        });
        if (!globalGrant.isSuccess) return globalGrant;

        // Invitation-Status → accepted via event-store-executor.
        // Tenant-scoping: ctx.db ist auf event.user.tenantId gescopt
        // (= NICHT der invitation-tenant). Eigene TenantDb für den
        // invitation-tenant bauen damit der executor die row findet.
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
