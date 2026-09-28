// Tenant-Invite magic-link: anonymous, read-only lookup so the invite
// acceptance page can pre-fill the email and choose between the
// accept-with-login (Branch 2) and signup-complete (Branch 3) forms before
// the user submits anything. Unlike the accept handlers, this never touches
// the token store — the token is not burned and stays usable for the
// actual accept call.

import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { decryptStoredPii } from "../../shared";
// kumiko-lint-ignore cross-feature-import invite-flow lebt in auth-email-password (Magic-Link), DB-row-owner ist tenant-feature
import { INVITATION_STATUS, tenantInvitationsTable } from "../../tenant/invitation-table";
// kumiko-lint-ignore cross-feature-import login-style account lookup, same as invite-accept-with-login
import { userTable } from "../../user/schema/user";
import { AuthErrors } from "../constants";
import { getInvitationIdForToken } from "../invite-token-store";

const InviteInfoSchema = z.object({
  token: z.string().min(1),
});

export type InviteInfoData = {
  readonly email: string;
  readonly hasAccount: boolean;
};

const READ_PENDING_INVITATION_REASON =
  "reads the pending invitation by id for the anonymous invite-info lookup; the caller has no tenant context yet";

// Every failure branch (unknown/expired token, non-pending invitation, no
// redis) collapses onto the same invalidInviteToken code as the accept
// handlers — anti-enumeration, same contract as invite-accept-with-login.
function throwInvalidInviteToken(): never {
  throw new UnprocessableError(AuthErrors.invalidInviteToken, {
    i18nKey: "auth.errors.invalidInviteToken",
  });
}

export const inviteInfoQuery = defineQueryHandler({
  name: "invite-info",
  schema: InviteInfoSchema,
  access: { roles: ["anonymous"] },
  rateLimit: { per: "ip+handler", limit: 20, windowSeconds: 60 },
  agent: { expose: false },
  escapeHatch: {
    reason: READ_PENDING_INVITATION_REASON,
  },
  description:
    "Anonymous, read-only invite lookup for the invite-acceptance page: reveals the invited " +
    "email and whether an account already exists for it, without consuming the token.",
  handler: async (query, ctx) => {
    if (!ctx.redis) throwInvalidInviteToken();

    const invitationId = await getInvitationIdForToken(ctx.redis, query.payload.token);
    if (!invitationId) throwInvalidInviteToken();

    type InvitationRow = {
      readonly status: string;
      readonly email: string;
    };
    type UserRow = {
      readonly id: string;
    };

    const invitation = await fetchOne<InvitationRow>(
      ctx.db.unsafeRaw(READ_PENDING_INVITATION_REASON),
      tenantInvitationsTable,
      { id: invitationId },
    );
    if (!invitation || invitation.status !== INVITATION_STATUS.pending) {
      throwInvalidInviteToken();
    }

    const invitationEmail = await decryptStoredPii(invitation.email, "email", "auth:invite-info");

    const userRow = await ctx.db.global(userTable).fetchOne<UserRow>({
      email: invitationEmail,
      isDeleted: false,
    });

    const data: InviteInfoData = {
      email: invitationEmail,
      hasAccount: userRow !== undefined,
    };
    return data;
  },
});
