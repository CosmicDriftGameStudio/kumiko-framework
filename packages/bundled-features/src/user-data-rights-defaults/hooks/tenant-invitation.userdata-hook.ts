import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  type UserDataDeleteHook,
  type UserDataExportHook,
  type UserDataHookCtx,
} from "@cosmicdrift/kumiko-framework/engine";
import { tenantInvitationEntity, tenantInvitationsTable } from "../../tenant";
import { userTable } from "../../user";
import { featureMounted } from "./feature-mounted";

// userData-Hooks for tenant-invitation rows. Event-sourced entity → all
// forget writes go through the executor so a projection rebuild replays the
// erasure (a direct write would be wiped — the Art.17 hole the user/fileRef
// hooks already close).
//
// Two subject paths in one hook:
//   invitee — rows whose `email` is the user's email. delete → executor
//             forget (row purged); anonymize → email pseudonymized.
//   inviter — rows whose `invitedBy` is the user. The row belongs to the
//             invitee, so both strategies only sever the person-link
//             (invitedBy → pseudonym; the field is required, null not
//             allowed).
//
// Email source: on forget the user hook may already have anonymized the
// user row, so ctx.userEmailBeforeDelete (captured by runForgetCleanup
// before the transaction) takes precedence over a live lookup.

const crud = createEventStoreExecutor(tenantInvitationsTable, tenantInvitationEntity, {
  entityName: "tenant-invitation",
});

const INVITED_BY_ANONYMIZED = "anonymized";

async function resolveUserEmail(ctx: UserDataHookCtx): Promise<string | null> {
  if (ctx.userEmailBeforeDelete) return ctx.userEmailBeforeDelete.toLowerCase();
  const row = (await fetchOne(ctx.db, userTable, { id: ctx.userId })) as {
    email: string;
  } | null; // @cast-boundary db-runner
  return row ? row.email.toLowerCase() : null;
}

export const tenantInvitationExportHook: UserDataExportHook = async (ctx) => {
  if (!featureMounted(ctx, "tenant")) return null;
  const email = await resolveUserEmail(ctx);
  if (!email) return null;
  // Invitation emails are lowercase-normalized on insert, so an exact match
  // is a case-insensitive match.
  const rows = await selectMany<Record<string, unknown>>(ctx.db, tenantInvitationsTable, {
    tenantId: ctx.tenantId,
    email,
  });
  if (rows.length === 0) return null;
  return {
    entity: "tenant-invitation",
    rows: rows.map((r) => ({
      email: r["email"],
      role: r["role"],
      status: r["status"],
      expiresAt: String(r["expiresAt"] ?? ""),
    })),
  };
};

export const tenantInvitationDeleteHook: UserDataDeleteHook = async (ctx, strategy) => {
  // skip: tenant not mounted — its table doesn't exist, nothing to erase.
  if (!featureMounted(ctx, "tenant")) return;
  const systemUser = createSystemUser(ctx.tenantId);
  const tdb = createTenantDb(ctx.db, ctx.tenantId, "system");

  const email = await resolveUserEmail(ctx);
  if (email) {
    const inviteeRows = await selectMany<Record<string, unknown>>(ctx.db, tenantInvitationsTable, {
      tenantId: ctx.tenantId,
      email,
    });
    for (const row of inviteeRows) {
      const id = row["id"]; // @cast-boundary db-row
      if (typeof id !== "string") continue;
      if (strategy === "delete") {
        await crud.forget({ id }, systemUser, tdb);
      } else {
        // Row-id in the pseudonym keeps the (tenantId, email) unique index
        // collision-free when a user has invitations in several states.
        await crud.update(
          { id, changes: { email: `forgotten-${id}@anonymized.invalid` } },
          systemUser,
          tdb,
          { skipOptimisticLock: true },
        );
      }
    }
  }

  const inviterRows = await selectMany<Record<string, unknown>>(ctx.db, tenantInvitationsTable, {
    tenantId: ctx.tenantId,
    invitedBy: ctx.userId,
  });
  for (const row of inviterRows) {
    const id = row["id"]; // @cast-boundary db-row
    if (typeof id !== "string") continue;
    await crud.update({ id, changes: { invitedBy: INVITED_BY_ANONYMIZED } }, systemUser, tdb, {
      skipOptimisticLock: true,
    });
  }
};
