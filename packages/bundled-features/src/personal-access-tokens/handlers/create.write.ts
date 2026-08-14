import { insertOne } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createSystemUser,
  defineWriteHandler,
  type HandlerContext,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { encryptForDirectWrite, verifyPassword } from "../../shared";
import { UserQueries } from "../../user";
import { PAT_DEFAULT_EXPIRES_IN_DAYS, PatErrors } from "../constants";
import { mintPatToken } from "../hash";
import { apiTokenEntity, apiTokenTable } from "../schema/api-token";

export type PatMfaVerifyResult = { readonly enrolled: boolean; readonly ok: boolean };

export type CreatePatOptions = {
  // Opt-in MFA re-auth gate — auth-mfa (if mounted) wires this in at
  // app-composition time via mfaVerifierFromFeature. Deliberately generic
  // here, same decoupling as login.write.ts's mfaStatusChecker: this
  // feature must not import auth-mfa's types, only this shape.
  readonly mfaVerifier?: (
    ctx: HandlerContext,
    userId: string,
    tenantId: TenantId,
    code: string | undefined,
  ) => Promise<PatMfaVerifyResult>;
};

function reauthFailed() {
  return writeFailure(
    new UnprocessableError(PatErrors.reauthRequired, {
      i18nKey: "errors.reauthRequired",
    }),
  );
}

// Mint a PAT for the calling user in their active tenant. The plaintext token
// is returned ONCE (data.token) and never again — only the hash is stored.
// `scopes` are granted scope names; unknown names simply grant nothing at
// resolve time (fail-closed), so no cross-check against the app config here.
//
// Minting a long-lived bearer credential re-verifies the caller's password
// (and MFA code, if enrolled) even though the request is already
// session-authed — a stolen/leaked session cookie must not be enough to
// stand up a durable API credential.
export function createPatCreateHandler(opts: CreatePatOptions = {}) {
  return defineWriteHandler({
    name: "create",
    schema: z.object({
      name: z.string().min(1).max(120),
      scopes: z.array(z.string().min(1)).min(1),
      expiresInDays: z.number().int().positive().max(3650).optional(),
      currentPassword: z.string().min(1),
      mfaCode: z.string().optional(),
    }),
    access: { openToAll: true },
    handler: async (event, ctx) => {
      const systemUser = createSystemUser(event.user.tenantId);
      const me = (await ctx.queryAs(systemUser, UserQueries.findForAuth, {
        id: event.user.id,
      })) as { passwordHash: string | null } | null; // @cast-boundary db-runner
      if (!me?.passwordHash) return reauthFailed();
      const passwordOk = await verifyPassword(me.passwordHash, event.payload.currentPassword);
      if (!passwordOk) return reauthFailed();

      if (opts.mfaVerifier) {
        const mfa = await opts.mfaVerifier(
          ctx,
          event.user.id,
          event.user.tenantId,
          event.payload.mfaCode,
        );
        if (mfa.enrolled && !mfa.ok) return reauthFailed();
      }

      const { raw, hash, prefix } = mintPatToken();
      const now = Temporal.Now.instant();
      const id = generateId();
      const row = await encryptForDirectWrite(
        apiTokenEntity,
        {
          id,
          userId: event.user.id,
          tenantId: event.user.tenantId,
          name: event.payload.name,
          tokenHash: hash,
          prefix,
          scopes: JSON.stringify(event.payload.scopes),
          createdAt: now,
          expiresAt: now.add({
            hours: 24 * (event.payload.expiresInDays ?? PAT_DEFAULT_EXPIRES_IN_DAYS),
          }),
          revokedAt: null,
        },
        "pat:create",
      );
      await insertOne(ctx.db, apiTokenTable, row);
      return { isSuccess: true, data: { id, token: raw, prefix } };
    },
  });
}
