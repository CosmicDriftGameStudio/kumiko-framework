import {
  access,
  createSystemUser,
  defineWriteHandler,
  SYSTEM_TENANT_ID,
} from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { AuthErrors, verifyPassword } from "../../auth-email-password";
import { UserErrors, UserHandlers, UserQueries } from "../../user";
import { UserProfileErrors } from "../constants";

// Gleiche Failure-Shape wie auth-email-password (anti-enumeration):
// dessen errors.ts ist nicht Teil des Feature-Barrels, der Reason-Code
// + i18nKey sind aber stabile Public-API.
// @wrapper-known error-helper
function invalidCredentials() {
  return writeFailure(
    new UnprocessableError(AuthErrors.invalidCredentials, {
      i18nKey: "auth.errors.invalidCredentials",
    }),
  );
}

// Change-email — authenticated, self-only. Der User bestätigt mit seinem
// aktuellen Passwort (Re-Auth wie change-password); die neue Adresse wird
// via ctx.writeAs(system) gegen den user-update-Handler geschrieben, weil
// `email` field-level privileged ist und bei Self-Updates sonst silent
// gestrippt würde. emailVerified flippt auf false — die App triggert
// anschließend den Verification-Flow (request-email-verification ist
// public; der ProfileScreen ruft ihn nach Erfolg auf).
export const changeEmailWrite = defineWriteHandler({
  name: "change-email",
  schema: z.object({
    currentPassword: z.string().min(1),
    newEmail: z.email(),
  }),
  access: { roles: access.authenticated },
  handler: async (event, ctx) => {
    const systemUser = createSystemUser(event.user.tenantId);

    const me = (await ctx.queryAs(systemUser, UserQueries.findForAuth, {
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
    if (newEmail === me.email.toLowerCase()) {
      return writeFailure(
        new UnprocessableError(UserProfileErrors.emailUnchanged, {
          i18nKey: "profile.errors.emailUnchanged",
        }),
      );
    }

    const existing = await ctx.queryAs(systemUser, UserQueries.findForAuth, { email: newEmail });
    if (existing !== null) {
      return writeFailure(
        new UnprocessableError(UserErrors.emailAlreadyExists, {
          i18nKey: "user.errors.emailAlreadyExists",
        }),
      );
    }

    // user ist systemStream (#497): der Event-Stream liegt deterministisch
    // auf SYSTEM_TENANT_ID. Pre-#497-Streams brauchen einmalig
    // backfillUserStreamTenants (#762).
    const writer = createSystemUser(SYSTEM_TENANT_ID);

    const writeRes = await ctx.writeAs(writer, UserHandlers.update, {
      id: me.id,
      version: me.version,
      changes: { email: newEmail, emailVerified: false },
    });
    if (!writeRes.isSuccess) return writeRes;

    return { isSuccess: true, data: { kind: "email-changed", email: newEmail } };
  },
});
