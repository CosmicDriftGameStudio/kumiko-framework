import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEventStoreExecutor,
  type DbRow,
  type TenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineWriteHandler,
  type SessionUser,
  withResponseData,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  InternalError,
  NotFoundError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import type { Redis } from "ioredis";
import * as z from "zod";
import { decryptStoredPii } from "../../shared/index.js";
import { userTable } from "../../user/index.js";
import { cancelPendingInvitation } from "../cancel-pending-invitation.js";
import { INVITATION_STATUS, tenantInvitationsTable } from "../invitation-table.js";
import { assertNotLastTenantAdmin } from "../last-tenant-admin.js";
import { tenantMembershipEntity, tenantMembershipsTable } from "../membership-table.js";

const executor = createEventStoreExecutor(tenantMembershipsTable, tenantMembershipEntity, {
  entityName: "tenant-membership",
});

type PendingInvitationCancel = {
  readonly userId: string;
  readonly tenantId: string;
  readonly actor: SessionUser;
  readonly redis: Redis | undefined;
};

async function cancelPendingInvitationsOfUser(
  db: TenantDb,
  options: PendingInvitationCancel,
): Promise<WriteFailure | undefined> {
  const user = await fetchOne<{ email: string | null }>(db, userTable, { id: options.userId });
  if (!user?.email) return undefined;
  const email = (await decryptStoredPii(user.email, "email", "tenant:remove-member")).toLowerCase();

  const pendingInvitations = await selectMany<{ id: string; version: number }>(
    db,
    tenantInvitationsTable,
    { tenantId: options.tenantId, email, status: INVITATION_STATUS.pending },
  );
  for (const invitation of pendingInvitations) {
    const failure = await cancelPendingInvitation(db, invitation, options.actor, options.redis);
    if (failure) return failure;
  }
  return undefined;
}

// Literal QN, not an import off the sessions feature — tenant is
// foundational and must boot without sessions mounted (no r.requires/
// r.usesApi here, unlike user-data-rights:restrict-account's hard dep).
const REVOKE_ALL_SESSIONS_QN = "sessions:write:user-session:revoke-all-for-user";

export const removeMemberWrite = defineWriteHandler({
  name: "removeMember",
  schema: z.object({ userId: z.string(), tenantId: z.string() }),
  access: { roles: ["SystemAdmin"] },
  description:
    "Removes a user's membership in a tenant and signs their sessions in that tenant out, refusing to strip the tenant's last TenantAdmin; use it when someone should lose access to a workspace.",
  agent: { risk: "high" },
  handler: async (event, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "tenant:write:removeMember requires ctx.systemDb — is r.systemScope() still set on the tenant feature?",
      });
    }
    const db = ctx.systemDb.acknowledgeCrossTenant(
      "SystemAdmin manages memberships across tenants",
    );
    const existing = await fetchOne(db, tenantMembershipsTable, {
      userId: event.payload.userId,
      tenantId: event.payload.tenantId,
    });
    if (!existing) {
      return writeFailure(
        new NotFoundError("membership", undefined, {
          i18nKey: "tenant.errors.membershipNotFound",
          i18nParams: { userId: event.payload.userId, tenantId: event.payload.tenantId },
        }),
      );
    }

    const currentRoles = parseRoles((existing as DbRow)["roles"]);
    if (currentRoles.includes("TenantAdmin")) {
      // assertNotLastTenantAdmin issues raw SQL, so it needs the raw runner, not
      // the tenant-scoped `db` — the count is filtered by the explicit tenantId.
      const lockRunner = ctx.systemDb.unsafeRaw(
        "tenant:write:removeMember last-TenantAdmin advisory lock + membership count",
      );
      const lastAdmin = await assertNotLastTenantAdmin(
        lockRunner,
        event.payload.tenantId,
        event.payload.userId,
        "remove",
      );
      if (lastAdmin !== undefined) return lastAdmin;
    }

    // Revoke THIS tenant's sessions BEFORE the delete — a removed member must
    // not keep a valid session for the window between the delete and a
    // post-delete revoke. Best-effort cross-feature call: sessions may not be
    // mounted (registry lookup, see above). If the delete then fails, the
    // member is logged out but the membership is intact — safe direction.
    const revoker = ctx.registry.getWriteHandler(REVOKE_ALL_SESSIONS_QN);
    if (revoker) {
      await ctx.writeAs(createSystemUser(event.payload.tenantId), REVOKE_ALL_SESSIONS_QN, {
        userId: event.payload.userId,
        tenantId: event.payload.tenantId,
      });
    }

    const result = await executor.delete(
      { id: (existing as DbRow)["id"] as string }, // @cast-boundary db-row
      event.user,
      db,
    );
    if (!result.isSuccess) return result;

    // Actor tenant = invitation tenant so the update hits the invitation's stream.
    const cancelFailure = await cancelPendingInvitationsOfUser(db, {
      userId: event.payload.userId,
      tenantId: event.payload.tenantId,
      actor: { ...event.user, tenantId: event.payload.tenantId },
      redis: ctx.redis,
    });
    if (cancelFailure !== undefined) return cancelFailure;

    return withResponseData(result, event.payload);
  },
});
