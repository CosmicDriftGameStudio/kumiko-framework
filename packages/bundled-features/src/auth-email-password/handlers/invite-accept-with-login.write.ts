// Tenant-Invite Step 2 — Branch 2 (anon User mit existing email).
//
// Flow:
//   1. User (nicht eingeloggt) klickt Invite-Link → /invite/accept?token=...
//   2. Frontend zeigt Login-Form mit pre-filled email (von der Invitation-
//      Page geliefert via separate Lookup-Query, oder vom User getippt)
//   3. User submitted email + password + token an diesen Handler
//   4. Server: login + accept in einem Schritt:
//      a. Token → invitationId → invitation row
//      b. Login-Check: Password gegen userTable für invitation.email
//      c. Email-Match (vom User-Input) === invitation.email
//      d. Membership-Add im invited Tenant
//      e. Invitation → status=accepted, Token gelöscht
//   5. Response: SessionUser + tenantKey für Auto-Login (analog signup-confirm)
//
// Anders als signup-confirm: KEIN neuer Tenant entsteht, KEIN neuer
// User entsteht — beide existieren bereits. Magic ist die kombinierte
// Login+Accept-Operation in einem Roundtrip.

import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineWriteHandler,
  type SessionUser,
  stripForbiddenMembershipRoles,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { decryptStoredPii } from "../../shared";
// kumiko-lint-ignore cross-feature-import invite-flow
import {
  INVITATION_STATUS,
  tenantInvitationEntity,
  tenantInvitationsTable,
} from "../../tenant/invitation-table";
// kumiko-lint-ignore cross-feature-import membership-seed-helper für privilegierten cross-tenant-add
import { seedTenantMembership } from "../../tenant/seeding";
// kumiko-lint-ignore cross-feature-import login-style password-check
import { userTable } from "../../user/schema/user";
import { invalidInviteToken, inviteEmailMismatch } from "../errors";
import {
  burnInviteToken,
  deleteInviteToken,
  getInvitationIdForToken,
  unburnInviteToken,
} from "../invite-token-store";
import { verifyPassword } from "../password-hashing";

const InviteAcceptWithLoginSchema = z.object({
  token: z.string().min(1),
  email: z.email(),
  password: z.string().min(8).max(200),
});

export type InviteAcceptWithLoginData = {
  readonly kind: "auth-session";
  readonly session: SessionUser;
  readonly tenantId: TenantId;
  readonly role: string;
};

const invitationExecutor = createEventStoreExecutor(
  tenantInvitationsTable,
  tenantInvitationEntity,
  { entityName: "tenant-invitation" },
);

export function createInviteAcceptWithLoginHandler() {
  return defineWriteHandler<
    "invite-accept-with-login",
    typeof InviteAcceptWithLoginSchema,
    InviteAcceptWithLoginData
  >({
    name: "invite-accept-with-login",
    schema: InviteAcceptWithLoginSchema,
    access: { roles: ["all"] },
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
      type UserAuthRow = { readonly id: string; readonly passwordHash: string | null };

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
          "auth:invite-accept-with-login",
        );
        const invitationRole = invitation.role;
        const invitationVersion = invitation.version;

        // Email-Match vom User-Input (nicht aus session — User ist anon)
        if (event.payload.email.toLowerCase() !== invitationEmail) {
          return inviteEmailMismatch();
        }

        // Password-Check gegen userTable. Anti-enumeration: bei
        // user-not-found ODER wrong-password collapsed beides auf
        // invalidInviteToken (gleicher anti-enum-Trade-off wie reset).
        const userRow = await fetchOne<UserAuthRow>(ctx.db.raw, userTable, {
          email: invitationEmail,
        });
        if (!userRow?.passwordHash) return invalidInviteToken();
        const passwordValid = await verifyPassword(userRow.passwordHash, event.payload.password);
        if (!passwordValid) return invalidInviteToken();

        const userId = userRow.id;

        // Already-Member-Check (idempotent)
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

        // Invitation → accepted: TenantDb für invitation-tenant.
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

        // SessionUser für JWT-Mint im invited Tenant. Roles =
        // [invitationRole] (Admin/Editor/User je nach invite).
        const session: SessionUser = {
          id: userId,
          tenantId: invitationTenantId,
          roles: stripForbiddenMembershipRoles([invitationRole]),
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
