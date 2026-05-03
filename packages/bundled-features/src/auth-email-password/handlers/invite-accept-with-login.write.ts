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

import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
  fetchOne,
} from "@kumiko/framework/db";
import {
  createSystemUser,
  defineWriteHandler,
  type SessionUser,
  type TenantId,
} from "@kumiko/framework/engine";
import { InternalError, UnprocessableError, writeFailure } from "@kumiko/framework/errors";
import { eq } from "drizzle-orm";
import { z } from "zod";
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
import { AuthErrors } from "../constants";
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

function invalidInviteToken() {
  return writeFailure(
    new UnprocessableError(AuthErrors.invalidInviteToken, {
      i18nKey: "auth.errors.invalidInviteToken",
    }),
  );
}

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

      let committed = false;
      try {
        const invitation = await fetchOne(
          ctx.db.raw,
          tenantInvitationsTable,
          eq(tenantInvitationsTable.id, invitationId),
        );
        if (!invitation || invitation["status"] !== INVITATION_STATUS.pending)
          return invalidInviteToken();

        const invitationTenantId = invitation["tenantId"] as TenantId;
        const invitationEmail = invitation["email"] as string;
        const invitationRole = invitation["role"] as string;
        const invitationVersion = invitation["version"] as number;

        // Email-Match vom User-Input (nicht aus session — User ist anon)
        if (event.payload.email.toLowerCase() !== invitationEmail) {
          return writeFailure(
            new UnprocessableError(AuthErrors.inviteEmailMismatch, {
              i18nKey: "auth.errors.inviteEmailMismatch",
            }),
          );
        }

        // Password-Check gegen userTable. Anti-enumeration: bei
        // user-not-found ODER wrong-password collapsed beides auf
        // invalidInviteToken (gleicher anti-enum-Trade-off wie reset).
        const userRow = await fetchOne(
          ctx.db.raw,
          userTable,
          eq(userTable.email, invitationEmail),
        );
        if (!userRow || !userRow["passwordHash"]) return invalidInviteToken();
        const passwordValid = await verifyPassword(
          userRow["passwordHash"] as string,
          event.payload.password,
        );
        if (!passwordValid) return invalidInviteToken();

        const userId = userRow["id"] as string;

        // Already-Member-Check (idempotent)
        const memberships = (await ctx.queryAs(
          createSystemUser(invitationTenantId),
          "tenant:query:memberships",
          { userId },
        )) as Array<{ tenantId: string }>;
        const alreadyMember = memberships.some((m) => m.tenantId === invitationTenantId);

        // @cast-boundary db-runner — TenantDb.raw is DbRunner
        const dbConn = ctx.db.raw as DbConnection;

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
          roles: [invitationRole],
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
