// Cancel-Handler für pending Invitations.
//
// Admin sieht eine pending Invitation und entscheidet sie zurückzu-
// nehmen (User soll doch nicht beitreten, falsche Email getippt etc.).
// Effekt:
//   - DB-row.status → "cancelled"
//   - Token aus Redis gelöscht (gemerkt im invite-token-store)
//
// Idempotent: cancellen einer schon-cancelled / accepted / expired
// invitation = no-op + 200. Cancellen einer non-existent invitation
// = invitation_not_found.

import { createEventStoreExecutor, fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
// kumiko-lint-ignore cross-feature-import cancel needs invite-token-store für Redis-cleanup
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
  access: { roles: ["Admin"] },
  handler: async (event, ctx) => {
    const invitation = await fetchOne(
      ctx.db.raw,
      tenantInvitationsTable,
      { id: event.payload.invitationId },
    );
    if (!invitation || invitation["tenantId"] !== event.user.tenantId) {
      return writeFailure(
        new NotFoundError("tenantInvitation", event.payload.invitationId, {
          i18nKey: "tenant.errors.invitationNotFound",
        }),
      );
    }

    // Idempotent: schon !pending → no-op success.
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
      ctx.db,
    );
    if (!updateResult.isSuccess) return updateResult;

    // Token aus Redis löschen (falls noch da). Wenn Redis nicht
    // verfügbar oder Token schon expired: kein Problem, DB-row ist
    // die Single-Source für UI.
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
