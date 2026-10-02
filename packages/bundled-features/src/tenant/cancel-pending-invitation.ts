import { createEventStoreExecutor, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import type { WriteFailure } from "@cosmicdrift/kumiko-framework/errors";
import type { Redis } from "ioredis";
// kumiko-lint-ignore cross-feature-import cancel needs invite-token-store for Redis cleanup
import { invalidateExistingInviteToken } from "../auth-email-password/invite-token-store.js";
import {
  INVITATION_STATUS,
  tenantInvitationEntity,
  tenantInvitationsTable,
} from "./invitation-table.js";

const invitationExecutor = createEventStoreExecutor(
  tenantInvitationsTable,
  tenantInvitationEntity,
  { entityName: "tenant-invitation" },
);

// Shared by cancel-invitation and remove-member so the cancel behavior
// (status transition + token invalidation) cannot drift between them.
export async function cancelPendingInvitation(
  db: TenantDb,
  invitation: { readonly id: string; readonly version: number },
  actor: SessionUser,
  redis: Redis | undefined,
): Promise<WriteFailure | undefined> {
  const updateResult = await invitationExecutor.update(
    {
      id: invitation.id,
      version: invitation.version,
      changes: { status: INVITATION_STATUS.cancelled },
    },
    actor,
    db,
  );
  if (!updateResult.isSuccess) return updateResult;

  // Delete the token from Redis (if still there). If Redis is
  // unavailable or the token already expired: not a problem, the DB
  // row is the single source of truth for the UI.
  if (redis) await invalidateExistingInviteToken(redis, invitation.id);
  return undefined;
}
