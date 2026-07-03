// Shared factory for the request-side of out-of-band token flows
// (password-reset, email-verification). Both follow the same shape:
//
//   POST email
//     → resolve user (system-scoped query)
//     → skip silently if user doesn't exist / is deleted / already done
//     → mint an HMAC-signed token
//     → return { kind: <successKind>, email, token, expiresAt }
//
// Differences between the flows are four parameters (successKind, sign fn,
// default TTL, extra skip condition) + two error codes — encoded on the
// spec rather than duplicated across two near-identical handler bodies.

import { createSystemUser, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { UnprocessableError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import type { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { UserQueries } from "../../user";
import { type AuthUserRow, parseAuthUserRow } from "../auth-user-row";
import type { AuthMailContent, AuthMailLocale, RenderTokenContentArgs } from "../email-templates";
import { dispatchMagicLinkMail } from "../magic-link-mail";

const RequestTokenSchema = z.object({
  email: z.email(),
});

// What the route layer reads off `result.data` after dispatching. Identical
// shape for both flows; only the `kind` discriminator differs so the route
// knows whether to forward to sendResetEmail or sendVerificationEmail.
export type TokenRequestSuccess<K extends string> = {
  readonly kind: K;
  readonly email: string;
  readonly token: string;
  readonly expiresAt: string;
};

export type TokenRequestNoOp = { readonly kind: "no-op" };

export type TokenRequestData<K extends string> = TokenRequestSuccess<K> | TokenRequestNoOp;

export type TokenRequestSpec<TName extends string, TSuccessKind extends string> = {
  readonly handlerName: TName;
  readonly successKind: TSuccessKind;
  readonly defaultTtlMinutes: number;
  // Feature-specific sign function. Signature matches both signResetToken
  // and signVerificationToken (thin wrappers over signed-token.ts).
  readonly sign: (
    userId: string,
    ttlMinutes: number,
    secret: string,
  ) => { token: string; expiresAt: Temporal.Instant };
  // Error code + i18nKey returned when the feature-factory wasn't given a
  // working hmacSecret. Should never happen — feature-factory validates at
  // boot — but defensive coverage for lazy secret-providers.
  readonly notConfiguredError: string;
  readonly notConfiguredI18nKey: string;
  // Extra silent-skip predicate on top of "user doesn't exist or is
  // soft-deleted". Verification skips when emailVerified is already true;
  // password-reset has no extra condition (returns false).
  readonly extraSilentSkip: (user: AuthUserRow) => boolean;
  // Notification type dispatched via ctx.notify on success. No r.notification
  // is declared (the recipient is an anonymous email, not a userId) — the
  // route:{email} path delivers directly and buildMessage falls back to data.
  readonly notificationType: string;
  // Builds the structured mail body from the magic-link + expiry. Per-flow
  // (renderResetPasswordEmail / renderVerifyEmail).
  readonly renderContent: (args: RenderTokenContentArgs) => AuthMailContent;
};

export type TokenRequestOptions = {
  readonly hmacSecret: string;
  readonly tokenTtlMinutes?: number;
  // App page that receives the magic-link; the handler appends `?token=…`.
  readonly appUrl: string;
  readonly appName?: string;
  readonly locale?: AuthMailLocale;
};

export function createTokenRequestHandler<TName extends string, TSuccessKind extends string>(
  spec: TokenRequestSpec<TName, TSuccessKind>,
  opts: TokenRequestOptions,
) {
  const ttl = opts.tokenTtlMinutes ?? spec.defaultTtlMinutes;

  return defineWriteHandler<TName, typeof RequestTokenSchema, TokenRequestData<TSuccessKind>>({
    name: spec.handlerName,
    schema: RequestTokenSchema,
    access: { roles: ["all"] },
    handler: async (event, ctx) => {
      if (!opts.hmacSecret) {
        // Feature-factory guards this at boot; defensive here for lazy-
        // provided secrets that show up empty at runtime.
        return writeFailure(
          new UnprocessableError(spec.notConfiguredError, {
            i18nKey: spec.notConfiguredI18nKey,
          }),
        );
      }

      const systemUser = createSystemUser(event.user.tenantId);

      const user = parseAuthUserRow(
        await ctx.queryAs(systemUser, UserQueries.findForAuth, {
          email: event.payload.email,
        }),
      );

      // Silent-success branches all return the SAME shape with kind="no-op".
      // Response-level timing stays uniform (200 / isSuccess: true); the
      // small difference in handler-internal work is accepted — no probing
      // client can observe it through the HTTP surface.
      if (!user || user.isDeleted || !user.email || spec.extraSilentSkip(user)) {
        const data: TokenRequestData<TSuccessKind> = { kind: "no-op" };
        // skip: silent no-op — uniform response prevents user-enumeration probing
        return { isSuccess: true, data };
      }

      const { token, expiresAt } = spec.sign(user.id, ttl, opts.hmacSecret);

      await dispatchMagicLinkMail(
        ctx.notify,
        {
          handlerName: spec.handlerName,
          notificationType: spec.notificationType,
          renderContent: spec.renderContent,
        },
        {
          // Row value is ciphertext with an active KMS; the byte-exact
          // lookup above guarantees the payload IS the stored plaintext.
          email: event.payload.email,
          appUrl: opts.appUrl,
          token,
          expiresAt: expiresAt.toString(),
          ...(opts.appName !== undefined && { appName: opts.appName }),
          ...(opts.locale !== undefined && { locale: opts.locale }),
        },
      );

      const data: TokenRequestData<TSuccessKind> = {
        kind: spec.successKind,
        email: event.payload.email,
        token,
        expiresAt: expiresAt.toString(),
      };
      return { isSuccess: true, data };
    },
  });
}
