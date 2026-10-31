import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { type FeatureWithEnvSchema, featureWithEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { createLateBoundSlot } from "../shared/index.ts";
import { type MfaRequiredPolicy, mfaRequiredConfigKey } from "./config.ts";
import { authMfaEnvSchema } from "./env.ts";
import type {
  BindMfaRevokeAllOtherSessions,
  BindMfaTokenSecrets,
  BindRevokeAllPatTokens,
} from "./feature-exports.ts";
import { createDisableHandler } from "./handlers/disable.write.ts";
import { createEnableConfirmHandler } from "./handlers/enable-confirm.write.ts";
import { createEnableConfirmPreauthHandler } from "./handlers/enable-confirm-preauth.write.ts";
import { createEnableStartHandler } from "./handlers/enable-start.write.ts";
import { createEnableStartPreauthHandler } from "./handlers/enable-start-preauth.write.ts";
import { mfaReencryptJob } from "./handlers/reencrypt.job.ts";
import { createRegenerateRecoveryHandler } from "./handlers/regenerate-recovery.write.ts";
import { mfaStatusQuery } from "./handlers/status.query.ts";
import { createMfaVerifyHandler } from "./handlers/verify.write.ts";
import { AUTH_MFA_FEATURE_I18N } from "./i18n.ts";
import { createMfaCodeVerifier } from "./mfa-code-verifier.ts";
import { createMfaStatusChecker } from "./mfa-status-checker.ts";
import { userMfaEntity } from "./schema/user-mfa.ts";
import { mfaDisableScreen, mfaEnableScreen, mfaRegenerateRecoveryScreen } from "./screens.ts";
import { type ResolvedMfaTokenSecrets, resolveMfaTokenSecretsFromEnv } from "./token-secrets.ts";

const REENCRYPT_ESCAPE_HATCH_REASON =
  "re-encrypts MFA secrets of every tenant's users with the new master key";

export type AuthMfaFeatureOptions = {
  // HMAC secret for the stateless enable-flow token (carries the generated
  // TOTP secret + recovery-code hashes between enable.start and
  // enable.confirm). Distinct secret from any other token flow in the app —
  // do not reuse passwordReset.hmacSecret. Unset: MFA_SETUP_TOKEN_SECRET or
  // derived from the master secret when the boot binds the token secrets.
  readonly setupTokenSecret?: string;
  // otpauth:// URI issuer — shown in the user's authenticator app next to
  // the account label ("Kumiko: jane@example.com").
  readonly issuer: string;
  // HMAC secret for the login-flow challenge token (carries {userId,
  // tenantId} between the password-check and /auth/mfa/verify). Distinct
  // secret from setupTokenSecret — a compromised setup-token secret must
  // not also forge login challenges. Unset: same fallback as setupTokenSecret.
  readonly challengeTokenSecret?: string;
  // App-wide MFA enforcement default when no tenant row overrides it.
  // Tenant admins cannot change the policy (system-only write), so this plus
  // system writes is the only way to set it. Defaults to "optional".
  readonly requiredPolicy?: MfaRequiredPolicy;
};

function hasBothExplicitSecrets(opts: AuthMfaFeatureOptions): boolean {
  return (
    opts.setupTokenSecret !== undefined &&
    opts.setupTokenSecret.trim() !== "" &&
    opts.challengeTokenSecret !== undefined &&
    opts.challengeTokenSecret.trim() !== ""
  );
}

export function createAuthMfaFeature(
  opts: AuthMfaFeatureOptions,
): FeatureWithEnvSchema<FeatureDefinition, typeof authMfaEnvSchema.shape> {
  const feature: FeatureDefinition = defineFeature("auth-mfa", (r) => {
    r.describe(
      "TOTP-based two-factor authentication: enable/disable flow with QR-code setup, 8 single-use recovery codes, and (once wired into a login flow) a second login step after password verification. Secrets are envelope-encrypted at rest via the same MasterKeyProvider as `secrets`/`config`.",
    );
    r.uiHints({
      displayLabel: "2FA / TOTP",
      category: "identity",
      recommended: true,
    });
    r.envSchema(authMfaEnvSchema);
    r.requires({ features: ["user"] });
    r.requires({ features: ["config"] });
    // verify.write.ts dispatches "tenant:query:memberships" — without this
    // the app boots clean and the first MFA login dies at runtime on an
    // unknown handler instead of failing at mount time.
    r.requires({ features: ["tenant"] });
    r.config("required", mfaRequiredConfigKey(opts.requiredPolicy));

    // Declarative secretMint screen — mint (no input) -> reveal QR/secret/
    // recovery-codes -> confirm with a code. App places it via r.nav in its
    // logged-in settings area (see personal-access-tokens/feature.ts for the
    // same convention).
    r.screen(mfaEnableScreen);
    r.screen(mfaDisableScreen);
    r.screen(mfaRegenerateRecoveryScreen);
    r.translations({ keys: AUTH_MFA_FEATURE_I18N });

    // KEK-rotation for totpSecret (entity-field encryption). Manual
    // trigger — ops runs it once after adding a new master key version,
    // same operator workflow as config's own reencrypt job.
    r.job({
      name: "reencrypt",
      trigger: { manual: true },
      escapeHatch: {
        reason: REENCRYPT_ESCAPE_HATCH_REASON,
      },
      handler: (payload, ctx) =>
        mfaReencryptJob(
          payload,
          ctx,
          ctx.db.unsafeRaw() as DbConnection, // @cast-boundary db-operator — jobs never run inside a DbTx
        ),
    });

    r.entity({ name: "user-mfa", ...userMfaEntity });

    // Late-bound by run-prod-app once the sessions feature (if mounted) has
    // produced a concrete `sessionRevokeAllOthers` callback — mirrors
    // sessions' own bindAutoRevokeOnPasswordChange. Shared by every handler
    // that changes MFA state (enable/disable/regenerate), so each one's
    // "log out every other session" behavior tracks the same wiring.
    const otherSessionsRevokerSlot =
      createLateBoundSlot<(userId: string, currentSid: string | undefined) => Promise<number>>();
    const sharedRevoker = (userId: string, currentSid: string | undefined): Promise<number> =>
      otherSessionsRevokerSlot.current()?.(userId, currentSid) ?? Promise.resolve(0);

    // Same late-bind shape as sharedRevoker above, for the personal-access-
    // tokens feature (if mounted). Wired to enable-confirm(-preauth)/disable
    // only — regenerate-recovery doesn't change enrollment state, so it's
    // out of scope for the "MFA-enable/disable" finding this mirrors.
    const patTokensRevokerSlot = createLateBoundSlot<(userId: string) => Promise<number>>();
    const sharedPatRevoker = (userId: string): Promise<number> =>
      patTokensRevokerSlot.current()?.(userId) ?? Promise.resolve(0);

    // Handlers and the status checker read the secrets through these getters
    // on each call, so the boot can bind them after env validation. Never
    // spread these objects: a spread would read the getter eagerly.
    let boundTokenSecrets: ResolvedMfaTokenSecrets | undefined = hasBothExplicitSecrets(opts)
      ? resolveMfaTokenSecretsFromEnv("", {}, opts)
      : undefined;
    const tokenSecrets = (): ResolvedMfaTokenSecrets => {
      if (boundTokenSecrets === undefined) {
        throw new Error(
          "[auth-mfa] token secrets are not bound: pass setupTokenSecret/challengeTokenSecret, or call bindMfaTokenSecretsFromFeature(feature)(masterSecret, env) in a custom boot (runProdApp, runDevApp and setupTestStack do this).",
        );
      }
      return boundTokenSecrets;
    };
    const bindTokenSecrets: BindMfaTokenSecrets = (masterSecret, env) => {
      boundTokenSecrets = resolveMfaTokenSecretsFromEnv(masterSecret, env, opts);
    };

    const handlers = {
      enableStart: r.writeHandler(
        createEnableStartHandler({
          get setupTokenSecret() {
            return tokenSecrets().setupTokenSecret;
          },
          issuer: opts.issuer,
        }),
      ),
      enableStartPreauth: r.writeHandler(
        createEnableStartPreauthHandler({
          get challengeTokenSecret() {
            return tokenSecrets().challengeTokenSecret;
          },
          get setupTokenSecret() {
            return tokenSecrets().setupTokenSecret;
          },
          issuer: opts.issuer,
        }),
      ),
      enableConfirm: r.writeHandler(
        createEnableConfirmHandler({
          get setupTokenSecret() {
            return tokenSecrets().setupTokenSecret;
          },
          revokeAllOtherSessions: sharedRevoker,
          revokeAllPatTokens: sharedPatRevoker,
        }),
      ),
      enableConfirmPreauth: r.writeHandler(
        createEnableConfirmPreauthHandler({
          get setupTokenSecret() {
            return tokenSecrets().setupTokenSecret;
          },
          revokeAllOtherSessions: sharedRevoker,
          revokeAllPatTokens: sharedPatRevoker,
        }),
      ),
      disable: r.writeHandler(
        createDisableHandler({
          revokeAllOtherSessions: sharedRevoker,
          revokeAllPatTokens: sharedPatRevoker,
        }),
      ),
      regenerateRecovery: r.writeHandler(
        createRegenerateRecoveryHandler({ revokeAllOtherSessions: sharedRevoker }),
      ),
      verify: r.writeHandler(
        createMfaVerifyHandler({
          get challengeTokenSecret() {
            return tokenSecrets().challengeTokenSecret;
          },
        }),
      ),
    };

    const queries = {
      status: r.queryHandler(mfaStatusQuery),
    };

    // No late-bind needed (unlike sharedRevoker) — this checker only needs
    // the HandlerContext the CALLER already has (login.write.ts runs it
    // from inside its own dispatcher call), not a raw db handle assembled
    // at app-boot time.
    const checkMfaStatus = createMfaStatusChecker({
      get challengeTokenSecret() {
        return tokenSecrets().challengeTokenSecret;
      },
      ...(opts.requiredPolicy && { requiredPolicy: opts.requiredPolicy }),
    });

    // No late-bind needed — same reasoning as checkMfaStatus: only needs the
    // HandlerContext the caller already has.
    const verifyMfaCode = createMfaCodeVerifier();

    const bindRevokeAllOtherSessions: BindMfaRevokeAllOtherSessions = otherSessionsRevokerSlot.bind;
    const bindRevokeAllPatTokens: BindRevokeAllPatTokens = patTokensRevokerSlot.bind;

    return {
      handlers,
      queries,
      bindRevokeAllOtherSessions,
      checkMfaStatus,
      verifyMfaCode,
      bindRevokeAllPatTokens,
      bindTokenSecrets,
    };
  });
  return featureWithEnvSchema(feature, authMfaEnvSchema);
}
