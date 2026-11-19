import {
  createEventStoreExecutor,
  type DbRunner,
  fetchOne,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  declareEscapeHatch,
  type HandlerContext,
  type TenantId,
  type WriteResult,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { decryptStoredPii } from "../shared/index.ts";
// kumiko-lint-ignore cross-feature-import the handler loads the pending invitation and marks it accepted
import {
  INVITATION_STATUS,
  tenantInvitationEntity,
  tenantInvitationsTable,
} from "../tenant/invitation-table.ts";
import { invalidInviteToken } from "./errors.ts";
import {
  burnInviteToken,
  deleteInviteToken,
  getInvitationIdForToken,
  unburnInviteToken,
} from "./invite-token-store.ts";

export type PendingInvitation = {
  readonly id: string;
  readonly status: string;
  readonly tenantId: TenantId;
  /** Decrypted. */
  readonly email: string;
  readonly role: string;
  readonly globalRoles: unknown;
  readonly version: number;
  readonly membershipVersion: number | null;
  readonly insertedAt: Temporal.Instant;
  readonly modifiedAt: Temporal.Instant | null;
};

type StoredInvitationRow = Omit<PendingInvitation, "id">;

const invitationExecutor = createEventStoreExecutor(
  tenantInvitationsTable,
  tenantInvitationEntity,
  { entityName: "tenant-invitation" },
);

// The token is deleted only after the whole accept callback succeeded and is
// released again on any failure or throw, so a failing step leaves the link usable.
export async function consumeInviteToken<TData>(
  ctx: HandlerContext,
  input: {
    readonly token: string;
    readonly handlerName: string;
    readonly piiReason: string;
  },
  accept: (invitation: PendingInvitation, dbConn: DbRunner) => Promise<WriteResult<TData>>,
): Promise<WriteResult<TData>> {
  const { token, handlerName, piiReason } = input;
  const redis = ctx.services.redis;
  if (!redis) {
    return writeFailure(
      new InternalError({
        message: `${handlerName} requires ctx.services.redis for token consumption`,
      }),
    );
  }

  const invitationId = await getInvitationIdForToken(redis, token);
  if (!invitationId) return invalidInviteToken();

  const burn = await burnInviteToken(redis, token);
  if (burn === "already-used") return invalidInviteToken();

  let committed = false;
  try {
    declareEscapeHatch({
      reason:
        "reads the pending invitation by id; the invitee is not yet a member of the invitation's tenant. The calling handler declares its own escapeHatch.",
      grants: ["unsafeRaw"],
    });
    const dbConn = ctx.db.unsafeRawAllTenants();
    const row = await fetchOne<StoredInvitationRow>(dbConn, tenantInvitationsTable, {
      id: invitationId,
    });
    if (!row || row.status !== INVITATION_STATUS.pending) return invalidInviteToken();

    const email = await decryptStoredPii(row.email, "email", piiReason);
    const result = await accept({ ...row, id: invitationId, email }, dbConn);
    if (result.isSuccess) {
      await deleteInviteToken(redis, { invitationId, token });
      committed = true;
    }
    return result;
  } finally {
    if (!committed) {
      await unburnInviteToken(redis, token);
    }
  }
}

export async function markInvitationAccepted(dbConn: DbRunner, invitation: PendingInvitation) {
  // ctx.db is scoped to the caller's tenant, the invitation row lives in the invitation's tenant.
  const invitationTdb = createTenantDb({
    db: dbConn,
    tenantId: invitation.tenantId,
    mode: "system",
    reason:
      "invitation tenant differs from the caller's tenant, the accept step updates the invitation row there",
  });
  return invitationExecutor.update(
    {
      id: invitation.id,
      version: invitation.version,
      changes: { status: INVITATION_STATUS.accepted },
    },
    createSystemUser(invitation.tenantId),
    invitationTdb,
  );
}
