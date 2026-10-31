import {
  createSystemUser,
  defineWriteHandler,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { invalidCredentials } from "../../auth-email-password/errors.ts";
import { decryptStoredPii, verifyPassword } from "../../shared/index.ts";
import { UserErrors, UserHandlers, UserQueries } from "../../user/index.ts";
import { UserProfileErrors } from "../web/constants.ts";

// Change-email — authenticated, self-only. The user confirms with their
// current password (re-authentication as with change-password); the new
// address is written through the user-update handler via ctx.dispatch.writeAs(system)
// because `email` is field-level privileged and would otherwise be silently
// stripped during self-updates. emailVerified is set to false — the app then
// triggers the verification flow (request-email-verification is public; the
// ProfileScreen calls it after success).
export const changeEmailWrite = defineWriteHandler({
  name: "change-email",
  schema: z.object({
    currentPassword: z.string().min(1),
    newEmail: z.email(),
  }),
  access: {
    openToAll: {
      reason:
        "self-service for any signed-in user, including tenant members whose only role is " +
        "TenantAdmin; the handler only touches event.user.id and re-checks the caller's password",
    },
  },
  escapeHatch: {
    grants: ["systemIdentity"],
    reason:
      "Reads the caller's own passwordHash via ctx.dispatch.queryAs(SYSTEM, user:findForAuth), checks " +
      "email uniqueness the same way, and writes the new email via ctx.dispatch.writeAs(SYSTEM, " +
      "user:update) — field-access on passwordHash/email is privileged-only.",
  },
  // Payload carries the current password.
  agent: { expose: false },
  description:
    "Replaces the signed-in caller's own email address after re-checking their current password, refusing an unchanged or already-taken address and clearing the verified flag so the app can re-run email verification.",
  handler: async (event, ctx) => {
    const systemUser = createSystemUser(event.user.tenantId);

    const me = (await ctx.dispatch.queryAs(systemUser, UserQueries.findForAuth, {
      id: event.user.id,
    })) as { id: string; email: string; passwordHash: string | null; version: number } | null; // @cast-boundary db-runner

    if (!me?.passwordHash) {
      return invalidCredentials();
    }

    const passwordOk = await verifyPassword(me.passwordHash, event.payload.currentPassword);
    if (!passwordOk) {
      return invalidCredentials();
    }

    const newEmail = event.payload.newEmail.toLowerCase();
    const currentEmail = await decryptStoredPii(me.email, "email", "user-profile:change-email");
    if (newEmail === currentEmail.toLowerCase()) {
      return writeFailure(
        new UnprocessableError(UserProfileErrors.emailUnchanged, {
          i18nKey: "profile.errors.emailUnchanged",
        }),
      );
    }

    const existing = await ctx.dispatch.queryAs(systemUser, UserQueries.findForAuth, {
      email: newEmail,
    });
    if (existing !== null) {
      return writeFailure(
        new UnprocessableError(UserErrors.emailAlreadyExists, {
          i18nKey: "user.errors.emailAlreadyExists",
        }),
      );
    }

    // user is systemStream: the event stream is deterministically located
    // on SYSTEM_TENANT_ID. Older streams require a one-time
    // backfillUserStreamTenants.
    const writer = createSystemUser(SYSTEM_TENANT_ID);

    const writeRes = await ctx.dispatch.writeAs(writer, UserHandlers.update, {
      id: me.id,
      version: me.version,
      changes: { email: newEmail, emailVerified: false },
    });
    if (!writeRes.isSuccess) return writeRes;

    return { isSuccess: true, data: { kind: "email-changed", email: newEmail } };
  },
});
