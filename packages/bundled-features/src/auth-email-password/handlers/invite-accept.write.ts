// Tenant-Invite Step 2 — Branch 1 (logged-in user accepts).
//
// User ist eingeloggt (in irgendeinem Tenant), klickt Accept-Link.
// Server:
//   1. Token → invitationId (Redis)
//   2. Burn (single-use)
//   3. Invitation-Row aus DB
//   4. Email-Match: invitation.email === user.email (sonst inviteEmailMismatch)
//   5. Already-Member-Check: User schon Member im invited Tenant → no-op success
//   6. Membership-Add via system-dispatcher (TenantHandlers.addMember)
//   7. Invitation-Row → status=accepted
//   8. Redis-Keys löschen (Burn-Key bleibt für Replay-Schutz)
//
// Branch 1 ist der klassische "shared workspace bei eingeloggter
// Session"-Flow. Branch 2 (anon + existing email) und Branch 3 (anon +
// new email) kommen als separate Handler.

import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
  fetchOne,
} from "@kumiko/framework/db";
import {
  createSystemUser,
  defineWriteHandler,
  type TenantId,
} from "@kumiko/framework/engine";
import { InternalError, UnprocessableError, writeFailure } from "@kumiko/framework/errors";
import { eq } from "drizzle-orm";
import { z } from "zod";
// kumiko-lint-ignore cross-feature-import invite-flow lebt in auth-email-password (Magic-Link), DB-row-owner ist tenant-feature
import { tenantInvitationEntity, tenantInvitationsTable } from "../../tenant/invitation-table";
// kumiko-lint-ignore cross-feature-import membership-seed-helper für privilegierten cross-tenant-add (analog provisionSignupAccount)
import { seedTenantMembership } from "../../tenant/seeding";
// kumiko-lint-ignore cross-feature-import auth handler reads user-row für email-match
import { userTable } from "../../user/schema/user";
import { AuthErrors } from "../constants";
import {
  burnInviteToken,
  deleteInviteToken,
  getInvitationIdForToken,
  unburnInviteToken,
} from "../invite-token-store";

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

function invalidInviteToken() {
  return writeFailure(
    new UnprocessableError(AuthErrors.invalidInviteToken, {
      i18nKey: "auth.errors.invalidInviteToken",
    }),
  );
}

export function createInviteAcceptHandler() {
  return defineWriteHandler<"invite-accept", typeof InviteAcceptSchema, InviteAcceptData>({
    name: "invite-accept",
    schema: InviteAcceptSchema,
    // openToAll: any authenticated user (Branch 1). Branch 2+3 (anon)
    // nutzen `roles: ["all"]` weil dort GUEST_USER mit ["all"]-role
    // dispatched wird.
    access: { openToAll: true },
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

      let committed = false;
      try {
        const invitation = await fetchOne(
          ctx.db.raw,
          tenantInvitationsTable,
          eq(tenantInvitationsTable.id, invitationId),
        );
        if (!invitation || invitation["status"] !== "pending") return invalidInviteToken();

        const invitationTenantId = invitation["tenantId"] as TenantId;
        const invitationEmail = invitation["email"] as string;
        const invitationRole = invitation["role"] as string;
        const invitationVersion = invitation["version"] as number;

        // Email-Match: User muss mit der eingeladenen Email matchen.
        // Sonst kann ein Angreifer mit Zugriff zur invitee-Mail seinen
        // eigenen Account dem Tenant zuschlagen.
        const userRow = await fetchOne(
          ctx.db.raw,
          userTable,
          eq(userTable.id, event.user.id),
        );
        if (!userRow || (userRow["email"] as string).toLowerCase() !== invitationEmail) {
          return writeFailure(
            new UnprocessableError(AuthErrors.inviteEmailMismatch, {
              i18nKey: "auth.errors.inviteEmailMismatch",
            }),
          );
        }

        // Already-Member-Check via memberships-query. Wenn der User schon
        // im invited Tenant Member ist, kein Error — no-op + 200 mit
        // alreadyMember=true (advisor-Constraint #4: idempotent).
        const memberships = (await ctx.queryAs(
          createSystemUser(invitationTenantId),
          "tenant:query:memberships",
          { userId: event.user.id },
        )) as Array<{ tenantId: string }>;
        const alreadyMember = memberships.some((m) => m.tenantId === invitationTenantId);

        // @cast-boundary db-runner — TenantDb.raw is DbRunner
        const dbConn = ctx.db.raw as DbConnection;

        if (!alreadyMember) {
          // Membership-Add via seedTenantMembership-helper (event-store-
          // executor pattern, gleich wie provisionSignupAccount). Nicht
          // dispatcher.writeAs(addMember) weil addMember-Handler nur
          // ["SystemAdmin"]-Role akzeptiert; createSystemUser produziert
          // "system"-Role die NICHT matcht. Direkt-via-Executor bypassed
          // den Access-Check für privilegierte Cross-Tenant-Operationen.
          await seedTenantMembership(dbConn, {
            userId: event.user.id,
            tenantId: invitationTenantId,
            roles: [invitationRole],
          });
        }

        // Invitation-Status → accepted via event-store-executor.
        // Tenant-scoping: ctx.db ist auf event.user.tenantId gescopt
        // (= NICHT der invitation-tenant). Eigene TenantDb für den
        // invitation-tenant bauen damit der executor die row findet.
        const invitationTdb = createTenantDb(dbConn, invitationTenantId, "system");
        const updateResult = await invitationExecutor.update(
          {
            id: invitationId,
            version: invitationVersion,
            changes: { status: "accepted" },
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
