// Magic-Link-Signup, Step 1 (request).
//
// User gibt Email ein → wir minten einen opaken Random-Token, speichern
// ihn bidirektional in Redis (token↔email), und schicken die Activation-Mail
// via delivery (ctx.notify) — wie reset/verify. Anders als die: HIER kein
// userId-Lookup und kein HMAC-signing (es gäbe kein Subject — im Normalfall
// existiert der User noch nicht). Ob die Email bereits ein Konto hat,
// entscheidet bewusst der Confirm-Schritt, nicht dieser.
//
// Resend: if a token is still live for this email, we invalidate it and
// mint a fresh one — the user gets a second mail with a NEW activation
// link, and the first link stops working. Deliberate: at most one live
// signup token per email at any time (see signup-token-store.ts).
//
// Always-200 (enumeration-safe): das Response sieht für jede Email gleich
// aus, egal ob sie schon registriert ist oder nicht. Eine Email KANN bereits
// ein Konto haben (Seeding oder früherer Signup) — die Sperre dagegen sitzt
// bewusst im Confirm-Schritt (#365): signup-confirm lehnt eine bereits
// registrierte Email ab statt den bestehenden User wiederzuverwenden. Hier
// bleibt's always-200 + Resend-idempotent, damit der Request-Pfad nichts
// leakt; ein request-seitiges Unterdrücken des Links wäre Defense-in-depth,
// aber mit Enumeration-Risiko (separat).

import { generateToken } from "@cosmicdrift/kumiko-framework/api";
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
  /** TTL für den Activation-Token. Default 24 h — lang genug damit User
   *  "morgen aktivieren" können ohne Resend-Spam. */
  readonly tokenTtlMinutes?: number;
  /** App page that receives the magic-link; the handler appends `?token=…`
   *  and dispatches the activation mail via delivery (ctx.notify). */
  readonly appUrl: string;
  readonly appName?: string;
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

      // Email-Normalisierung lebt im Store (signup-token-store). Der
      // Handler reicht die raw email durch — eine Quelle, kein Drift
      // zwischen Lookup-Pfaden die unterschiedlich (oder gar nicht)
      // lowercased haben.
      const email = event.payload.email;

      // At most one live signup token per email: invalidate whatever's
      // there before minting the new one (see signup-token-store.ts).
      await invalidateExistingSignupToken(ctx.redis, email);
      // 32 random bytes = 256 bits unguessable randomness, base64url
      // encoded zu 43 chars. Math.random war früher ein Bug:
      // xorshift128+ hat ~128 Bit State der nach ~5 beobachteten
      // Outputs rekonstruierbar ist — Angreifer könnte eigene
      // signup-requests triggern und die Tokens fremder User
      // vorhersagen. generateToken nutzt randomBytes aus node:crypto,
      // dieselbe Quelle wie CSRF/Session-Tokens.
      const token = generateToken();

      const expiresAt = Temporal.Now.instant().add({ seconds: ttlSeconds });
      const expiresAtIso = expiresAt.toString();

      await storeSignupToken(ctx.redis, { email, token, ttlSeconds });

      // normalizeEmail aus dem Store — eine Quelle für die Normalisierungs-
      // Verantwortung; delivery-Empfänger + Lookup-Pfad kriegen konsistent
      // das gleiche Format.
      const normalizedEmail = normalizeEmail(email);

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
          ...(opts.locale !== undefined && { locale: opts.locale }),
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
