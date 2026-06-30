import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import type { AuthMailLocale } from "./email-templates";
import { changePasswordWrite } from "./handlers/change-password.write";
import { createInviteAcceptHandler } from "./handlers/invite-accept.write";
import { createInviteAcceptWithLoginHandler } from "./handlers/invite-accept-with-login.write";
import {
  createInviteCreateHandler,
  type InviteCreateOptions,
} from "./handlers/invite-create.write";
import { createInviteSignupCompleteHandler } from "./handlers/invite-signup-complete.write";
import { createLoginHandler } from "./handlers/login.write";
import { logoutWrite } from "./handlers/logout.write";
import { createRequestEmailVerificationHandler } from "./handlers/request-email-verification.write";
import { createRequestPasswordResetHandler } from "./handlers/request-password-reset.write";
import { createResetPasswordHandler } from "./handlers/reset-password.write";
import { createSignupConfirmHandler } from "./handlers/signup-confirm.write";
import {
  createSignupRequestHandler,
  type SignupRequestOptions,
} from "./handlers/signup-request.write";
import { createVerifyEmailHandler } from "./handlers/verify-email.write";

/**
 * Env-vars contract for the `auth-email-password` feature.
 *
 * `JWT_SECRET` is read by `runProdApp` at boot to sign session JWTs.
 * Apps mount this feature via `createAuthEmailPasswordFeature(opts)` and
 * pass `jwtSecret` to `runProdApp` separately — declaring it here means
 * `composeEnvSchema({ features: [authFeature, ...] })` flags a missing
 * or short JWT_SECRET at the aggregated boot-validation stage instead of
 * letting it surface as a JWT-decode-failure on first login.
 *
 * `JWT_ISSUER` is optional (Hono-JWT pins the `iss` claim when set).
 */
export const authEmailPasswordEnvSchema = z.object({
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be ≥32 chars (HS256 minimum)")
    .describe("Symmetric secret for signing session JWTs (HS256).")
    .meta({ kumiko: { pulumi: { generator: "openssl rand -base64 48", secret: true } } }),
  JWT_ISSUER: z
    .string()
    .min(1)
    .optional()
    .describe("Optional `iss` claim pinned on every minted JWT."),
});

// Opt-in configuration for the password-reset flow. When omitted the
// request-password-reset / reset-password handlers are not registered —
// the framework-level routes stay 404 and callers know the flow is off.
// Keeping this at the feature level (rather than via env) means the caller
// explicitly acknowledges that reset is wired and that they have a working
// sendResetEmail callback on the framework side.
export type PasswordResetOptions = {
  readonly hmacSecret: string;
  readonly tokenTtlMinutes?: number;
  // App page that receives the magic-link; the handler appends `?token=…` and
  // sends the mail via delivery (ctx.notify). No sendResetEmail callback — the
  // app mounts `delivery` + a mail channel instead.
  readonly appUrl: string;
  readonly appName?: string;
  readonly locale?: AuthMailLocale;
};

// Opt-in configuration for the email-verification flow. mode="strict"
// forces login to fail with email_not_verified when the flag is false;
// "off" registers the handlers without login-gating (useful during
// rollout so existing accounts keep working). Default: strict — if you
// wire verification at all, you probably want it enforced.
export type EmailVerificationOptions = {
  readonly hmacSecret: string;
  readonly tokenTtlMinutes?: number;
  readonly mode?: "strict" | "off";
  // App page that receives the magic-link; the handler appends `?token=…` and
  // sends via delivery (ctx.notify). No sendVerificationEmail callback.
  readonly appUrl: string;
  readonly appName?: string;
  readonly locale?: AuthMailLocale;
};

// Brute-force protection on the login handler. Omit for the defaults
// (5 failures → 15-minute lock). Set the dial knobs to override.
//
// Storage: Redis (keyed by userId). Without ctx.redis the handler skips
// lockout entirely — login still works, but brute-force protection falls
// back to the IP-rate-limiter. Counter is monotonic: only a successful
// login resets it, so after a lockout expires the next wrong password
// re-locks on attempt 1 (strict semantic — see lockout-store.ts for
// rationale).
export type AccountLockoutOptions = {
  readonly maxFailedAttempts?: number;
  readonly lockoutDurationMinutes?: number;
};

// Magic-Link Self-Signup. Wenn gesetzt, registriert das Feature die
// signup-request + signup-confirm-Handler. Der Token-Store (Redis)
// kommt aus ctx.redis — tokenTtlMinutes ist der einzige Knopf
// (Token-Material ist generateToken() = 256 Bit randomBytes, fest;
// Memory feedback_no_options_without_need: keine Knöpfe ohne Bedarf).
// Anders als reset/verify gibt's kein hmacSecret hier, weil der Token
// opaque random ist (Redis ist Source of Truth).
export type SignupOptions = SignupRequestOptions;

// Tenant-Invite Magic-Link. Wenn gesetzt, registriert das Feature die
// invite-create + invite-accept-Handler. Branch 2+3 (anon-flows) kommen
// als separate Handler in einem Folge-Schritt. tokenTtlMinutes Default
// 7 Tage (industry standard).
export type InviteOptions = InviteCreateOptions;

export type AuthEmailPasswordOptions = {
  readonly passwordReset?: PasswordResetOptions;
  readonly emailVerification?: EmailVerificationOptions;
  readonly accountLockout?: AccountLockoutOptions;
  readonly signup?: SignupOptions;
  readonly invite?: InviteOptions;
};

// Auth feature — email+password login. Depends on the user feature for
// identity lookups (via ctx.queryAs) and on the tenant feature for
// membership resolution. No direct imports of foreign tables.
export function createAuthEmailPasswordFeature(
  opts: AuthEmailPasswordOptions = {},
): FeatureDefinition {
  if (opts.passwordReset && !opts.passwordReset.hmacSecret) {
    throw new Error(
      "[auth-email-password] passwordReset.hmacSecret must be non-empty when passwordReset is configured",
    );
  }
  if (opts.emailVerification && !opts.emailVerification.hmacSecret) {
    throw new Error(
      "[auth-email-password] emailVerification.hmacSecret must be non-empty when emailVerification is configured",
    );
  }

  const strictVerification =
    opts.emailVerification !== undefined && (opts.emailVerification.mode ?? "strict") === "strict";

  return defineFeature("auth-email-password", (r) => {
    r.describe(
      "Provides email+password authentication: the always-on handlers are `login`, `changePassword`, and `logout`; optional flows \u2014 password reset, email verification, magic-link self-signup, and tenant invite \u2014 are registered only when you pass their respective option objects (`passwordReset`, `emailVerification`, `signup`, `invite`) to `createAuthEmailPasswordFeature(opts)`. All four magic-link flows (reset, verification, signup activation, tenant invite) dispatch their mail through the `delivery` feature via `ctx.notify`, so mounting any of them additionally requires `delivery`. Tokens are HMAC-signed (reset/verify) or opaque-random in Redis (signup/invite). Requires the `user` and `tenant` features, and declares `JWT_SECRET` (\u2265 32 chars) in `authEmailPasswordEnvSchema` so a missing secret surfaces at boot validation rather than on the first login attempt.",
    );
    r.uiHints({
      displayLabel: "Auth \u00b7 Email + Password",
      category: "identity",
      recommended: true,
      configurableOptions: [
        { key: "passwordReset", label: "Password-Reset-Flow", type: "boolean", default: true },
        {
          key: "emailVerification",
          label: "Email-Verification-Flow",
          type: "boolean",
          default: true,
        },
        { key: "signup", label: "Self-Signup-Flow", type: "boolean", default: false },
        { key: "invite", label: "Tenant-Invite-Flow", type: "boolean", default: false },
      ],
    });
    r.requires("user");
    r.requires("tenant");
    // All four magic-link flows (reset/verify/signup/invite) dispatch via
    // ctx.notify → delivery must be mounted. Fail closed at boot instead of
    // silently dropping the mail.
    if (opts.passwordReset || opts.emailVerification || opts.signup || opts.invite) {
      r.requires("delivery");
    }
    r.envSchema(authEmailPasswordEnvSchema);

    const handlers = {
      login: r.writeHandler(
        createLoginHandler({
          strictEmailVerification: strictVerification,
          accountLockout: opts.accountLockout,
        }),
      ),
      changePassword: r.writeHandler(changePasswordWrite),
      logout: r.writeHandler(logoutWrite),
    };

    if (opts.passwordReset) {
      r.writeHandler(createRequestPasswordResetHandler(opts.passwordReset));
      r.writeHandler(createResetPasswordHandler(opts.passwordReset));
    }

    if (opts.emailVerification) {
      r.writeHandler(createRequestEmailVerificationHandler(opts.emailVerification));
      r.writeHandler(createVerifyEmailHandler(opts.emailVerification));
    }

    if (opts.signup) {
      r.writeHandler(createSignupRequestHandler(opts.signup));
      r.writeHandler(createSignupConfirmHandler());
    }

    if (opts.invite) {
      r.writeHandler(createInviteCreateHandler(opts.invite));
      r.writeHandler(createInviteAcceptHandler());
      r.writeHandler(createInviteAcceptWithLoginHandler());
      r.writeHandler(createInviteSignupCompleteHandler());
    }

    return { handlers };
  });
}
