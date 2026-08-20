// Magic-link signup, step 1 (request).
//
// User enters an email → we mint an opaque random token, store it
// bidirectionally in Redis (token<->email), and send the activation mail
// via delivery (ctx.notify) — same as reset/verify. Unlike those: NO
// userId lookup and NO HMAC signing here (there'd be no subject — normally
// the user doesn't exist yet). Whether the email already has an account is
// deliberately decided by the confirm step, not this one.
//
// Resend: if a token is still live for this email, we invalidate it and
// mint a fresh one — the user gets a second mail with a NEW activation
// link, and the first link stops working. Deliberate: at most one live
// signup token per email at any time (see signup-token-store.ts).
//
// Always-200 (enumeration-safe): the response looks the same for every
// email, whether it's already registered or not. An email CAN already have
// an account (seeding or an earlier signup) — the actual gate sits
// deliberately in the confirm step (#365): signup-confirm rejects an
// already-registered email instead of reusing the existing user. Here it
// stays always-200 + resend-idempotent so the request path leaks nothing;
// suppressing the link on the request side would be defense-in-depth, but
// with an enumeration risk of its own (separate concern).

import { generateToken, requestContext } from "@cosmicdrift/kumiko-framework/api";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { AUTH_SIGNUP_DEFAULT_TTL_MINUTES } from "../constants";
import type { AuthMailLocale } from "../email-templates";
import { renderActivationEmail } from "../email-templates";
import { dispatchMagicLinkMail } from "../magic-link-mail";
import { AUTH_SELF_REGISTRATION_FEATURE } from "../self-registration-toggle";
import {
  invalidateExistingSignupToken,
  normalizeEmail,
  storeSignupToken,
} from "../signup-token-store";

const SIGNUP_NOTIFICATION_TYPE = "auth-email-password:signup-activation";

const SignupRequestSchema = z.object({
  email: z.email(),
});

export type SignupRequestData =
  | {
      readonly kind: "signup-requested";
      readonly email: string;
      readonly token: string;
      readonly expiresAt: string;
    }
  | { readonly kind: "no-op" };

export type SignupRequestOptions = {
  /** TTL for the activation token. Default 24h — long enough that users
   *  can "activate tomorrow" without resend spam. */
  readonly tokenTtlMinutes?: number;
  /** App page that receives the magic-link; the handler appends `?token=…`
   *  and dispatches the activation mail via delivery (ctx.notify). Apps
   *  with language-in-path routing pass a function to pick the right page
   *  for the resolved locale; everyone else keeps a plain string. */
  readonly appUrl: string | ((locale: string) => string);
  readonly appName?: string;
  /** Static fallback mail locale for this handler instance, used only when
   *  the request itself carries no locale signal (no X-Locale header, no
   *  usable Accept-Language) — see the locale resolution below. */
  readonly locale?: AuthMailLocale;
};

export function createSignupRequestHandler(opts: SignupRequestOptions) {
  const ttlMinutes = opts.tokenTtlMinutes ?? AUTH_SIGNUP_DEFAULT_TTL_MINUTES;
  const ttlSeconds = ttlMinutes * 60;

  return defineWriteHandler<"signup-request", typeof SignupRequestSchema, SignupRequestData>({
    name: "signup-request",
    schema: SignupRequestSchema,
    access: { roles: ["all"] },
    handler: async (event, ctx) => {
      // Silent no-op when off, matching the route's own always-200
      // anti-enumeration contract (registerTokenRequestRoute swallows every
      // handler failure into `{isSuccess:true}` regardless) — no mail goes
      // out, but the caller can't distinguish "disabled" from "unknown
      // email" either way. The client-visible signal is the `status` query
      // on auth-self-registration, which the signup page uses to hide its
      // own link/form instead of collecting input that silently no-ops.
      // Fail-open when the companion toggle feature isn't composed at all —
      // ctx.hasFeature() is fail-closed for *unregistered* names the moment
      // feature-toggles/tier-engine is wired, which silently kills
      // self-signup for every existing app that mounts auth-email-password
      // without also composing createAuthSelfRegistrationToggleFeature()
      // (#1468). Only gate when the toggle actually exists.
      const gated = ctx.registry.getFeature(AUTH_SELF_REGISTRATION_FEATURE) !== undefined;
      if (gated && !(await ctx.hasFeature(AUTH_SELF_REGISTRATION_FEATURE))) {
        // No email address here — this fires on every no-op request, PII
        // must not accumulate in logs just for the "was this toggled off"
        // signal a support ticket needs.
        ctx.log?.info("signup-request skipped: self-registration disabled");
        return { isSuccess: true, data: { kind: "no-op" } };
      }
      if (!ctx.redis) {
        return writeFailure(
          new InternalError({
            message: "signup-request requires ctx.redis for the activation-token store",
          }),
        );
      }

      // Email normalization lives in the store (signup-token-store). The
      // handler passes the raw email through — one source, no drift
      // between lookup paths that lowercase differently (or not at all).
      const email = event.payload.email;

      // At most one live signup token per email: invalidate whatever's
      // there before minting the new one (see signup-token-store.ts).
      await invalidateExistingSignupToken(ctx.redis, email);
      // 32 random bytes = 256 bits unguessable randomness, base64url
      // encoded to 43 chars. Math.random used to be a bug here:
      // xorshift128+ has ~128 bits of state that's reconstructible after
      // ~5 observed outputs — an attacker could trigger their own
      // signup-requests and predict other users' tokens. generateToken
      // uses randomBytes from node:crypto, the same source as CSRF/
      // session tokens.
      const token = generateToken();

      const expiresAt = Temporal.Now.instant().add({ seconds: ttlSeconds });
      const expiresAtIso = expiresAt.toString();

      await storeSignupToken(ctx.redis, { email, token, ttlSeconds });

      // normalizeEmail from the store — one source of truth for
      // normalization; the delivery recipient + lookup path consistently
      // get the same format.
      const normalizedEmail = normalizeEmail(email);

      // ctx.locale always resolves to something (falls back to the app's
      // boot default, then "en" — dispatch-shared.ts), so it can't tell us
      // whether THIS request actually carried a locale signal. Read the raw
      // request-layer value instead: present → the browser's active
      // language wins over opts.locale (this handler's static config);
      // absent → opts.locale is the real, still-relevant fallback
      // (backwards compatibility for callers that configured it and never
      // send X-Locale), then ctx.locale's own resolved default.
      const locale = requestContext.get()?.locale ?? opts.locale ?? ctx.locale;

      await dispatchMagicLinkMail(
        ctx.notify,
        {
          handlerName: "signup-request",
          notificationType: SIGNUP_NOTIFICATION_TYPE,
          renderContent: renderActivationEmail,
        },
        {
          email: normalizedEmail,
          appUrl: opts.appUrl,
          token,
          expiresAt: expiresAtIso,
          ...(opts.appName !== undefined && { appName: opts.appName }),
          locale,
        },
      );

      return {
        isSuccess: true,
        data: {
          kind: "signup-requested",
          email: normalizedEmail,
          token,
          expiresAt: expiresAtIso,
        },
      };
    },
  });
}
