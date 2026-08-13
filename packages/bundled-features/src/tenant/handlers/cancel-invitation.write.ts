// Cancel handler for pending invitations.
//
// Admin sees a pending invitation and decides to withdraw it (user
// shouldn't join after all, wrong email typed, etc.).
// Effect:
//   - DB row.status → "cancelled"
//   - Token deleted from Redis (tracked in invite-token-store)
//
// Idempotent: cancelling an already-cancelled / accepted / expired
// invitation = no-op + 200. Cancelling a non-existent invitation
// = invitation_not_found.

import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { access, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
// kumiko-lint-ignore cross-feature-import cancel needs invite-token-store for Redis cleanup
import {
  deleteInviteToken,
  getTokenForInvitation,
} from "../../auth-email-password/invite-token-store";
import {
  INVITATION_STATUS,
  tenantInvitationEntity,
  tenantInvitationsTable,
} from "../invitation-table";

const CancelInvitationSchema = z.object({
  invitationId: z.string(),
});

const executor = createEventStoreExecutor(tenantInvitationsTable, tenantInvitationEntity, {
  entityName: "tenant-invitation",
});

export const cancelInvitationWrite = defineWriteHandler({
  name: "cancel-invitation",
  schema: CancelInvitationSchema,
  access: { roles: access.admin },
  handler: async (event, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "tenant:write:cancel-invitation requires ctx.systemDb — is r.systemScope() still set on the tenant feature?",
      });
    }
    const db = ctx.systemDb.assertTenantMatch(event.user.tenantId);
    const invitation = await fetchOne(db, tenantInvitationsTable, {
      id: event.payload.invitationId,
      tenantId: event.user.tenantId,
    });
    // The tenantId check below is redundant with the where-clause above but
    // kept as defense in depth — this is a security-cutover diff, not the
    // place to also drop an existing check.
    if (!invitation || invitation["tenantId"] !== event.user.tenantId) {
      return writeFailure(
        new NotFoundError("tenantInvitation", event.payload.invitationId, {
          i18nKey: "tenant.errors.invitationNotFound",
        }),
      );
    }

    // Idempotent: already !pending → no-op success.
    if (invitation["status"] !== INVITATION_STATUS.pending) {
      return { isSuccess: true, data: { id: event.payload.invitationId, alreadyDone: true } };
    }

    // Status update via event-store
    const updateResult = await executor.update(
      {
        id: event.payload.invitationId,
        version: invitation["version"] as number, // @cast-boundary db-row
        changes: { status: INVITATION_STATUS.cancelled },
      },
      event.user,
      db,
    );
    if (!updateResult.isSuccess) return updateResult;

    // Delete the token from Redis (if still there). If Redis is
    // unavailable or the token already expired: not a problem, the DB
    // row is the single source of truth for the UI.
    if (ctx.redis) {
      const token = await getTokenForInvitation(ctx.redis, event.payload.invitationId);
      if (token) {
        await deleteInviteToken(ctx.redis, {
          invitationId: event.payload.invitationId,
          token,
        });
      }
    }

    return { isSuccess: true, data: { id: event.payload.invitationId, alreadyDone: false } };
  },
});
