import { access, createSystemUser, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { UserHandlers, UserQueries } from "../../user";
import { AuthErrors } from "../constants";
import { hashPassword, verifyPassword } from "../password-hashing";

function invalidCredentials() {
  return writeFailure(
    new UnprocessableError(AuthErrors.invalidCredentials, {
      i18nKey: "auth.errors.invalidCredentials",
    }),
  );
}

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
    })) as { id: number; passwordHash: string | null; version: number } | null;

    if (!me?.passwordHash) {
      return invalidCredentials();
    }

    const oldOk = await verifyPassword(me.passwordHash, event.payload.oldPassword);
    if (!oldOk) {
      return invalidCredentials();
    }

    const newHash = await hashPassword(event.payload.newPassword);

    // Apply via user feature's update handler — writeAs(system) satisfies
    // the privileged-only write rule on passwordHash. Pass the current version
    // through so optimistic locking still applies end-to-end.
    const writeRes = await ctx.writeAs(systemUser, UserHandlers.update, {
      id: me.id,
      version: me.version,
      changes: { passwordHash: newHash },
    });
    if (!writeRes.isSuccess) return writeRes;

    return { isSuccess: true, data: { kind: "password-changed" } };
  },
});
