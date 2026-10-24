import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { type FeatureWithEnvSchema, featureWithEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import * as z from "zod";
import type { AuthMailLocale } from "./email-templates.ts";
import { changePasswordWrite } from "./handlers/change-password.write.ts";
import { createConfirmAccountUnlockHandler } from "./handlers/confirm-account-unlock.write.ts";
import { createInviteAcceptHandler } from "./handlers/invite-accept.write.ts";
import { createInviteAcceptWithLoginHandler } from "./handlers/invite-accept-with-login.write.ts";
import {
  createInviteCreateHandler,
  createSystemInviteCreateHandler,
  type InviteCreateOptions,
} from "./handlers/invite-create.write.ts";
import { inviteInfoQuery } from "./handlers/invite-info.query.ts";
import { createInviteSignupCompleteHandler } from "./handlers/invite-signup-complete.write.ts";
import { createLoginHandler, type LoginHandlerOptions } from "./handlers/login.write.ts";
import { loginOptionsQuery } from "./handlers/login-options.query.ts";
import { logoutWrite } from "./handlers/logout.write.ts";
import {
  createRequestAccountUnlockHandler,
  type RequestAccountUnlockOptions,
} from "./handlers/request-account-unlock.write.ts";
import { createRequestEmailVerificationHandler } from "./handlers/request-email-verification.write.ts";
import { createRequestPasswordResetHandler } from "./handlers/request-password-reset.write.ts";
import { createResetPasswordHandler } from "./handlers/reset-password.write.ts";
import { selfRegistrationStatusQuery } from "./handlers/self-registration-status.query.ts";
import { createSignupConfirmHandler } from "./handlers/signup-confirm.write.ts";
import {
  createSignupRequestHandler,
  type SignupRequestOptions,
} from "./handlers/signup-request.write.ts";
import { createSwitchTenantMfaGateHandler } from "./handlers/switch-tenant-mfa-gate.write.ts";
import { createVerifyEmailHandler } from "./handlers/verify-email.write.ts";
import {
  AUTH_MAIL_VARIABLES,
  authMailLocalizedTemplate,
  INVITE_MAIL_VARIABLES,
  sendsMagicLinkMail,
} from "./mail-notifications.ts";
import { MIN_HMAC_SECRET_LENGTH } from "./web/constants.ts";
import { AUTH_EMAIL_PASSWORD_MAIL_I18N } from "./web/mail-i18n.ts";

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
  // app mounts `delivery` + a mail channel instead. Apps with language-in-path
  // routing may pass a function to pick the right page for the resolved
  // locale instead of a plain string.
  readonly appUrl: string | ((locale: string) => string);
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
  // sends via delivery (ctx.notify). No sendVerificationEmail callback. Apps
  // with language-in-path routing may pass a function to pick the right page
  // for the resolved locale instead of a plain string.
  readonly appUrl: string | ((locale: string) => string);
  readonly appName?: string;
  readonly locale?: AuthMailLocale;
};

// Brute-force protection on the login handler. Omit for the defaults
// (5 failures → 15-minute lock). Set the dial knobs to override.
//
// Storage: Redis (keyed by userId). Without ctx.services.redis the handler skips
// lockout entirely — login still works, but brute-force protection falls
// back to the IP-rate-limiter. Counter is monotonic: only a successful
// login resets it, so after a lockout expires the next wrong password
// re-locks on attempt 1 (strict semantic — see lockout-store.ts for
// rationale).
export type AccountLockoutOptions = {
  readonly maxFailedAttempts?: number;
  readonly lockoutDurationMinutes?: number;
};

// Unlike reset/verify there is no hmacSecret: the signup token is opaque random
// (256 bit) and Redis is the source of truth, so tokenTtlMinutes is the only knob.
export type SignupOptions = SignupRequestOptions;

// Tenant-invite magic link. When set, the feature registers the
// invite-create and invite-accept handlers. Branches 2 and 3 (anonymous
// flows) will be added as separate handlers later. The default
// tokenTtlMinutes is 7 days (industry standard).
export type InviteOptions = InviteCreateOptions;

// Account-Unlock Magic-Link. When set, registers the
// request-account-unlock + confirm-account-unlock handlers — the
// self-service escape hatch for the monotonic lockout counter (see
// lockout-store.ts). Only meaningful paired with `accountLockout`, but
// wired independently like passwordReset/emailVerification — no implicit
// auto-enable, so apps without lockout don't get an unasked-for new
// public endpoint.
export type AccountUnlockOptions = RequestAccountUnlockOptions;

export type AuthEmailPasswordOptions = {
  // Second-factor gate. auth-mfa (if mounted) wires this in via
  // mfaStatusCheckerFromFeature() at app-composition time — see
  // LoginHandlerOptions.mfaStatusChecker for the contract it must satisfy.
  readonly mfaStatusChecker?: LoginHandlerOptions["mfaStatusChecker"];
  readonly passwordReset?: PasswordResetOptions;
  readonly emailVerification?: EmailVerificationOptions;
  readonly accountLockout?: AccountLockoutOptions;
  readonly signup?: SignupOptions;
  readonly invite?: InviteOptions;
  readonly accountUnlock?: AccountUnlockOptions;
};

// Auth feature — email+password login. Depends on the user feature for
// identity lookups (via ctx.dispatch.queryAs) and on the tenant feature for
// membership resolution. No direct imports of foreign tables.
export function createAuthEmailPasswordFeature(
  opts: AuthEmailPasswordOptions = {},
): FeatureWithEnvSchema<FeatureDefinition, typeof authEmailPasswordEnvSchema.shape> {
  // ≥32 chars, symmetric to the JWT_SECRET env check: a short HMAC secret
  // makes reset/verify tokens forgeable — that's account takeover, so the
  // factory fails fast instead of trusting the caller.
  if (opts.passwordReset && opts.passwordReset.hmacSecret.length < MIN_HMAC_SECRET_LENGTH) {
    throw new Error(
      `[auth-email-password] passwordReset.hmacSecret must be ≥${MIN_HMAC_SECRET_LENGTH} chars (HMAC-SHA256 token signing)`,
    );
  }
  if (opts.emailVerification && opts.emailVerification.hmacSecret.length < MIN_HMAC_SECRET_LENGTH) {
    throw new Error(
      `[auth-email-password] emailVerification.hmacSecret must be ≥${MIN_HMAC_SECRET_LENGTH} chars (HMAC-SHA256 token signing)`,
    );
  }
  if (opts.accountUnlock && opts.accountUnlock.hmacSecret.length < MIN_HMAC_SECRET_LENGTH) {
    throw new Error(
      `[auth-email-password] accountUnlock.hmacSecret must be ≥${MIN_HMAC_SECRET_LENGTH} chars (HMAC-SHA256 token signing)`,
    );
  }

  const strictVerification =
    opts.emailVerification !== undefined && (opts.emailVerification.mode ?? "strict") === "strict";

  const feature: FeatureDefinition = defineFeature("auth-email-password", (r) => {
    r.describe(
      "Provides email+password authentication: the always-on handlers are `login`, `changePassword`, and `logout`; optional flows — password reset, email verification, magic-link self-signup, tenant invite, and account-unlock — are registered only when you pass their respective option objects (`passwordReset`, `emailVerification`, `signup`, `invite`, `accountUnlock`) to `createAuthEmailPasswordFeature(opts)`. All five magic-link flows dispatch their mail through the `delivery` feature via `ctx.notify`, so mounting any of them additionally requires `delivery`. Tokens are HMAC-signed (reset/verify/unlock) or opaque-random in Redis (signup/invite). `accountUnlock` is the self-service escape hatch for `accountLockout`'s monotonic failure-counter (#1266): confirming the mailed token clears the Redis lockout state without touching the user entity. Requires the `user` and `tenant` features, and declares `JWT_SECRET` (≥ 32 chars) in `authEmailPasswordEnvSchema` so a missing secret surfaces at boot validation rather than on the first login attempt.",
    );
    // kumiko-lint-ignore i18n-ui-strings uiHints labels are feature-registry metadata for the admin feature catalog, not yet wired to the i18n system
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
        { key: "accountUnlock", label: "Account-Unlock-Flow", type: "boolean", default: false },
      ],
    });
    r.requires({ features: ["user", "tenant"] });
    // All five magic-link flows (reset/verify/signup/invite/unlock) dispatch
    // via ctx.notify → delivery must be mounted. Fail closed at boot instead
    // of silently dropping the mail.
    if (sendsMagicLinkMail(opts)) r.requires({ features: ["delivery"] });
    r.envSchema(authEmailPasswordEnvSchema);
    r.translations({ keys: AUTH_EMAIL_PASSWORD_MAIL_I18N });

    // Declared unconditionally: apps also issue the activation link from their
    // own flows (issueSignupActivation) without enabling the signup option.
    r.notification("password-reset", {
      variables: AUTH_MAIL_VARIABLES,
      localizedTemplate: authMailLocalizedTemplate("passwordReset"),
    });
    r.notification("account-unlock", {
      variables: AUTH_MAIL_VARIABLES,
      localizedTemplate: authMailLocalizedTemplate("accountUnlock"),
    });
    r.notification("email-verification", {
      variables: AUTH_MAIL_VARIABLES,
      localizedTemplate: authMailLocalizedTemplate("emailVerification"),
    });
    r.notification("signup-activation", {
      variables: AUTH_MAIL_VARIABLES,
      localizedTemplate: authMailLocalizedTemplate("signupActivation"),
    });
    r.notification("invite", {
      variables: INVITE_MAIL_VARIABLES,
      localizedTemplate: authMailLocalizedTemplate("invite"),
    });

    const handlers = {
      login: r.writeHandler(
        createLoginHandler({
          strictEmailVerification: strictVerification,
          accountLockout: opts.accountLockout,
          mfaStatusChecker: opts.mfaStatusChecker,
        }),
      ),
      changePassword: r.writeHandler(changePasswordWrite),
      logout: r.writeHandler(logoutWrite),
    };

    if (opts.mfaStatusChecker) {
      r.writeHandler(createSwitchTenantMfaGateHandler({ mfaStatusChecker: opts.mfaStatusChecker }));
    }

    if (opts.passwordReset) {
      r.writeHandler(createRequestPasswordResetHandler(opts.passwordReset));
      r.writeHandler(createResetPasswordHandler(opts.passwordReset));
    }

    if (opts.emailVerification) {
      r.writeHandler(createRequestEmailVerificationHandler(opts.emailVerification));
      r.writeHandler(createVerifyEmailHandler(opts.emailVerification));
    }

    const queries = {
      loginOptions: r.queryHandler(loginOptionsQuery),
      ...(opts.signup && {
        signupRegistrationStatus: r.queryHandler(selfRegistrationStatusQuery),
      }),
      ...(opts.invite && {
        inviteInfo: r.queryHandler(inviteInfoQuery),
      }),
    };

    if (opts.signup) {
      r.writeHandler(createSignupRequestHandler(opts.signup));
      r.writeHandler(createSignupConfirmHandler({ mfaStatusChecker: opts.mfaStatusChecker }));
    }

    if (opts.invite) {
      r.writeHandler(createInviteCreateHandler(opts.invite));
      r.writeHandler(createSystemInviteCreateHandler(opts.invite));
      r.writeHandler(createInviteAcceptHandler());
      // Same gates as the `login` handler above (lockout, password,
      // email-verified, account-status, MFA) — see invite-accept-with-login.write.ts.
      r.writeHandler(
        createInviteAcceptWithLoginHandler({
          mfaStatusChecker: opts.mfaStatusChecker,
          accountLockout: opts.accountLockout,
          strictEmailVerification: strictVerification,
        }),
      );
      r.writeHandler(
        createInviteSignupCompleteHandler({ mfaStatusChecker: opts.mfaStatusChecker }),
      );
    }

    if (opts.accountUnlock) {
      r.writeHandler(createRequestAccountUnlockHandler(opts.accountUnlock));
      r.writeHandler(createConfirmAccountUnlockHandler(opts.accountUnlock));
    }

    return { handlers, queries };
  });
  return featureWithEnvSchema(feature, authEmailPasswordEnvSchema);
}
