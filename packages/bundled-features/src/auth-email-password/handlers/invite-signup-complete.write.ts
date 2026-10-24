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

import {
  createEventStoreExecutor,
  createTenantDb,
  type DbConnection,
  fetchOne,
} from "@cosmicdrift/kumiko-framework/db";
import {
  buildSessionRoles,
  createSystemUser,
  defineWriteHandler,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { decryptStoredPii, registrationLocaleFromRequest } from "../../shared/index.ts";
// kumiko-lint-ignore cross-feature-import invite-flow
import {
  INVITATION_STATUS,
  tenantInvitationEntity,
  tenantInvitationsTable,
} from "../../tenant/invitation-table.ts";
// kumiko-lint-ignore cross-feature-import reserved-role check owned by tenant-feature
import {
  findForbiddenMembershipRole,
  reservedMembershipRoleError,
} from "../../tenant/membership-roles.ts";
// kumiko-lint-ignore cross-feature-import membership-seed-helper for privileged cross-tenant addition
import { seedTenantMembership } from "../../tenant/seeding.ts";
// kumiko-lint-ignore cross-feature-import global roles granted on invite accept live on the user row
import { parseInvitedGlobalRoles } from "../../user/invited-global-roles.ts";
// kumiko-lint-ignore cross-feature-import existence-check
import { userTable } from "../../user/schema/user.ts";
import { invalidInviteToken } from "../errors.ts";
import {
  burnInviteToken,
  deleteInviteToken,
  getInvitationIdForToken,
  unburnInviteToken,
} from "../invite-token-store.ts";
import { passwordSchema } from "../password-policy.ts";
// kumiko-lint-ignore cross-feature-import provisioning needs cross-feature seeding helpers
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

const invitationExecutor = createEventStoreExecutor(
  tenantInvitationsTable,
  tenantInvitationEntity,
  { entityName: "tenant-invitation" },
);

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
    handler: async (event, ctx) => {
      if (!ctx.services.redis) {
        return writeFailure(
          new InternalError({ message: "invite-signup-complete requires ctx.redis" }),
        );
      }

      const invitationId = await getInvitationIdForToken(ctx.services.redis, event.payload.token);
      if (!invitationId) return invalidInviteToken();

      const burn = await burnInviteToken(ctx.services.redis, event.payload.token);
      if (burn === "already-used") return invalidInviteToken();

      type InvitationRow = {
        readonly status: string;
        readonly tenantId: TenantId;
        readonly email: string;
        readonly role: string;
        readonly globalRoles: unknown;
        readonly version: number;
      };

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
          "auth:invite-signup-complete",
        );
        const invitationRole = invitation.role;
        const invitationGlobalRoles = parseInvitedGlobalRoles(invitation.globalRoles);
        const invitationVersion = invitation.version;

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
        // @cast-boundary db-runner — helpers use only the query API that
        // DbConnection and DbTx share.
        const dbConn = ctx.db.unsafeRaw() as DbConnection;
        const registrationLocale = registrationLocaleFromRequest();
        const { id: userId } = await seedUserWithPassword(dbConn, {
          email: invitationEmail,
          password: event.payload.password,
          displayName: invitationEmail.split("@")[0] ?? invitationEmail,
          emailVerified: true,
          ...registrationLocale,
          ...(invitationGlobalRoles.length > 0 && { roles: invitationGlobalRoles }),
        });

        // The seed helper bypasses addMember's access check because
        // createSystemUser does not match ["SystemAdmin"].
        const forbiddenInviteRole = findForbiddenMembershipRole([invitationRole]);
        if (forbiddenInviteRole !== undefined) {
          return writeFailure(reservedMembershipRoleError(forbiddenInviteRole));
        }
        await seedTenantMembership(dbConn, {
          userId,
          tenantId: invitationTenantId,
          roles: [invitationRole],
        });

        // Update the invitation in the invited tenant's database context.
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

        // buildSessionRoles calls stripForbiddenMembershipRoles internally —
        // a reserved role on the invitation itself must never reach the session.
        const mergedRoles = buildSessionRoles(invitationGlobalRoles, [invitationRole]);

        // Same gate as invite-accept-with-login: the account exists after this
        // call, but an MFA-gated role gets the MFA step instead of a session.
        // It runs before the token is deleted so a throwing check leaves the link retryable.
        const mfaGate = await gateEnforceMfa(
          ctx,
          { mfaStatusChecker: opts.mfaStatusChecker },
          userId,
          invitationTenantId,
          mergedRoles,
        );

        await deleteInviteToken(ctx.services.redis, { invitationId, token: event.payload.token });

        if (mfaGate !== undefined) {
          committed = true;
          return { isSuccess: true, data: mfaGate };
        }

        const session: SessionUser = {
          id: userId,
          tenantId: invitationTenantId,
          roles: mergedRoles,
          ...registrationLocale,
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
        if (!committed && ctx.services.redis) {
          await unburnInviteToken(ctx.services.redis, event.payload.token);
        }
      }
    },
  });
}
