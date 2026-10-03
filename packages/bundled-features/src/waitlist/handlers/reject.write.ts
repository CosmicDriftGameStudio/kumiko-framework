import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createSystemUser,
  defineWriteHandler,
  type HandlerContext,
  parseTenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  InternalError,
  NotFoundError,
  UnprocessableError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import {
  cancelPendingInvitation,
  INVITATION_STATUS,
  tenantInvitationsTable,
} from "../../tenant/index.js";
import { WAITLIST_STATUS, WaitlistErrors } from "../constants.js";
import { isOpenWaitlistStatus } from "../entity.js";
import {
  adminAccess,
  normalizeEmail,
  platformActor,
  waitlistDb,
  waitlistExecutor,
} from "../lib.js";
import { WaitlistIdSchema } from "../payloads.js";

export type WaitlistRejectData = { readonly kind: "rejected"; readonly id: string };

// An invited entry already has a live invitation link; rejecting must kill it,
// otherwise the rejected person can still sign up. Once accepted they hold
// access, which only tenant member removal may revoke.
async function revokeInvitation(
  row: Record<string, unknown>,
  ctx: HandlerContext,
): Promise<WriteFailure | undefined> {
  const { status, linkedTenantId, email } = row;
  if (status !== WAITLIST_STATUS.Invited) return undefined;
  const tenantId = typeof linkedTenantId === "string" ? parseTenantId(linkedTenantId) : null;
  if (!tenantId || typeof email !== "string") return undefined;
  const db = waitlistDb(ctx);
  const invitations = await selectMany(db, tenantInvitationsTable, {
    tenantId,
    email: normalizeEmail(email),
  });
  if (invitations.some((invitation) => invitation["status"] === INVITATION_STATUS.accepted)) {
    return writeFailure(new UnprocessableError(WaitlistErrors.notRejectable));
  }
  for (const invitation of invitations) {
    if (invitation["status"] !== INVITATION_STATUS.pending) continue;
    const id = invitation["id"];
    const version = invitation["version"];
    if (typeof id !== "string" || typeof version !== "number") {
      throw new InternalError({ message: "waitlist:reject: malformed invitation row" });
    }
    const cancelled = await cancelPendingInvitation(
      db,
      { id, version },
      createSystemUser(tenantId),
      ctx.redis,
    );
    if (cancelled) return cancelled;
  }
  return undefined;
}

export const rejectHandler = defineWriteHandler<
  "reject",
  typeof WaitlistIdSchema,
  WaitlistRejectData
>({
  name: "reject",
  schema: WaitlistIdSchema,
  access: adminAccess,
  description:
    "Marks a pending or invited waitlist entry as rejected, used by admins to dismiss spam or noise; the row and its personal data stay until erased.",
  handler: async (event, ctx) => {
    const db = waitlistDb(ctx);
    const row = await waitlistExecutor.detail({ id: event.payload.id }, platformActor(), db);
    if (!row) return writeFailure(new NotFoundError("waitlistEntry", event.payload.id));
    const version = row["version"];
    if (typeof version !== "number") {
      throw new InternalError({ message: "waitlist:reject: malformed waitlist row" });
    }
    if (!isOpenWaitlistStatus(row["status"])) {
      return writeFailure(new UnprocessableError(WaitlistErrors.notRejectable));
    }
    const revoked = await revokeInvitation(row, ctx);
    if (revoked) return revoked;
    const updated = await waitlistExecutor.update(
      { id: event.payload.id, version, changes: { status: WAITLIST_STATUS.Rejected } },
      platformActor(),
      db,
    );
    if (!updated.isSuccess) return updated;
    return { isSuccess: true, data: { kind: "rejected", id: event.payload.id } };
  },
});
