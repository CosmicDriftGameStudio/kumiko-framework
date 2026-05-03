import { defineFeature, type FeatureDefinition } from "@kumiko/framework/engine";
import { changePasswordWrite } from "./handlers/change-password.write";
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

// Opt-in configuration for the password-reset flow. When omitted the
// request-password-reset / reset-password handlers are not registered —
// the framework-level routes stay 404 and callers know the flow is off.
// Keeping this at the feature level (rather than via env) means the caller
// explicitly acknowledges that reset is wired and that they have a working
// sendResetEmail callback on the framework side.
export type PasswordResetOptions = {
  readonly hmacSecret: string;
  readonly tokenTtlMinutes?: number;
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
// kommt aus ctx.redis — TTL und Token-Length sind die einzigen Knöpfe.
// Anders als reset/verify gibt's kein hmacSecret hier, weil der Token
// opaque random ist (Redis ist Source of Truth).
//
// Strukturell identisch zu SignupRequestOptions, aber explizit
// re-deklariert (nicht als type-alias) damit der dev-server-Wrapper
// die felder als regular properties — nicht als index-signature —
// destrukturieren kann.
export type SignupOptions = {
  readonly tokenTtlMinutes?: number;
  readonly tokenLength?: number;
};

export type AuthEmailPasswordOptions = {
  readonly passwordReset?: PasswordResetOptions;
  readonly emailVerification?: EmailVerificationOptions;
  readonly accountLockout?: AccountLockoutOptions;
  readonly signup?: SignupOptions;
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
    r.requires("user");
    r.requires("tenant");

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

    return { handlers };
  });
}
