// Tenant-Invite Step 2 — Branch 3 (anon User, Email NICHT registriert).
//
// Anders als signup-confirm: KEIN neuer Tenant entsteht. Der Tenant
// existiert schon (im invitation-row), wir legen NUR User+Membership an.
//
// Flow:
//   1. User klickt Invite-Link → /invite/signup?token=...
//   2. Frontend zeigt Password-Form (email kommt aus invitation, kein
//      User-Input damit kein Email-Mismatch möglich)
//   3. User submitted password + token
//   4. Server:
//      a. Token → invitationId → invitation row
//      b. User-Existence-Check: invitation.email darf NICHT in userTable
//         existieren (sonst soll Branch 2 oder Branch 1 genutzt werden)
//      c. Create user (emailVerified=true wegen Magic-Link)
//      d. Add membership im invited Tenant
//      e. Invitation → accepted, Token gelöscht
//   5. Response: SessionUser + tenantId für Auto-Login

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
// kumiko-lint-ignore cross-feature-import provisioning needs cross-feature seeding helpers
import { seedUserWithPassword } from "../seeding";
// kumiko-lint-ignore cross-feature-import membership-seed-helper für privilegierten cross-tenant-add
import { seedTenantMembership } from "../../tenant/seeding";
// kumiko-lint-ignore cross-feature-import existence-check
import { userTable } from "../../user/schema/user";
import { AuthErrors } from "../constants";
import {
  burnInviteToken,
  deleteInviteToken,
  getInvitationIdForToken,
  unburnInviteToken,
} from "../invite-token-store";

const InviteSignupCompleteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200),
});

export type InviteSignupCompleteData = {
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

export function createInviteSignupCompleteHandler() {
  return defineWriteHandler<
    "invite-signup-complete",
    typeof InviteSignupCompleteSchema,
    InviteSignupCompleteData
  >({
    name: "invite-signup-complete",
    schema: InviteSignupCompleteSchema,
    access: { roles: ["all"] },
    handler: async (event, ctx) => {
      if (!ctx.redis) {
        return writeFailure(
          new InternalError({ message: "invite-signup-complete requires ctx.redis" }),
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

        // User-Not-Exists-Check: wenn die Email schon registriert ist,
        // muss der User Branch 2 (acceptWithLogin) nutzen. Hier ist
        // explizit "neue Email" — sonst hätten wir zwei Wege ein
        // Password zu setzen für denselben User.
        const existingUser = await fetchOne(
          ctx.db.raw,
          userTable,
          eq(userTable.email, invitationEmail),
        );
        if (existingUser) return invalidInviteToken();

        // User anlegen via seedUserWithPassword (gleiches Pattern wie
        // signup-confirm), emailVerified=true wegen Magic-Link.
        // @cast-boundary db-runner — TenantDb.raw is DbRunner; seed-helpers
        // operate on plain drizzle-API which both shapes expose identically.
        const dbConn = ctx.db.raw as DbConnection;
        const userId = await seedUserWithPassword(dbConn, {
          email: invitationEmail,
          password: event.payload.password,
          displayName: invitationEmail.split("@")[0] ?? invitationEmail,
          emailVerified: true,
        });

        // Membership-Add via seed-helper (gleiches Pattern wie
        // provisionSignupAccount — bypassed addMember access-check
        // weil createSystemUser nicht ["SystemAdmin"] matcht).
        await seedTenantMembership(dbConn, {
          userId,
          tenantId: invitationTenantId,
          roles: [invitationRole],
        });

        // Invitation → accepted: TenantDb für invitation-tenant
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
