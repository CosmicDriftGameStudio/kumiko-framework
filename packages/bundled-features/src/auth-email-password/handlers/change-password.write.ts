import {
  access,
  createSystemUser,
  defineWriteHandler,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../../shared";
import { UserHandlers, UserQueries } from "../../user";
import { invalidCredentials } from "../errors";

// Change-password — authenticated. The user supplies their current password
// (re-auth) and the new one. The new hash is written via ctx.writeAs(system)
// against the user feature's update handler; field-access on passwordHash
// (privileged-only) lets the system identity through.
export const changePasswordWrite = defineWriteHandler({
  name: "change-password",
  schema: z.object({
    oldPassword: z.string().min(1),
    newPassword: z.string().min(8).max(200),
  }),
  access: { roles: access.authenticated },
  handler: async (event, ctx) => {
    const systemUser = createSystemUser(event.user.tenantId);

    // Load self with passwordHash — only visible to the privileged caller.
    const me = (await ctx.queryAs(systemUser, UserQueries.findForAuth, {
      id: event.user.id,
    })) as { id: number; passwordHash: string | null; version: number } | null; // @cast-boundary db-runner

    if (!me?.passwordHash) {
      return invalidCredentials();
    }

    const oldOk = await verifyPassword(me.passwordHash, event.payload.oldPassword);
    if (!oldOk) {
      return invalidCredentials();
    }

    const newHash = await hashPassword(event.payload.newPassword);

    // The user aggregate is systemStream (#497): its event stream lives on
    // SYSTEM_TENANT_ID deterministically. Pre-#497 scattered streams need the
    // one-time backfillUserStreamTenants migration (#762).
    const writer = createSystemUser(SYSTEM_TENANT_ID);

    // Apply via user feature's update handler — writeAs(system) satisfies
    // the privileged-only write rule on passwordHash. Pass the current version
    // through so optimistic locking still applies end-to-end.
    const writeRes = await ctx.writeAs(writer, UserHandlers.update, {
      id: me.id,
      version: me.version,
      changes: { passwordHash: newHash },
    });
    if (!writeRes.isSuccess) return writeRes;

    return { isSuccess: true, data: { kind: "password-changed" } };
  },
});
