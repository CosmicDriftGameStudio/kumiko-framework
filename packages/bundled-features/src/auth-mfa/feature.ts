import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createDisableHandler } from "./handlers/disable.write";
import { createEnableConfirmHandler } from "./handlers/enable-confirm.write";
import { createEnableStartHandler } from "./handlers/enable-start.write";
import { createRegenerateRecoveryHandler } from "./handlers/regenerate-recovery.write";
import { userMfaEntity } from "./schema/user-mfa";

export type AuthMfaFeatureOptions = {
  // HMAC secret for the stateless enable-flow token (carries the generated
  // TOTP secret + recovery-code hashes between enable.start and
  // enable.confirm). Distinct secret from any other token flow in the app —
  // do not reuse passwordReset.hmacSecret.
  readonly setupTokenSecret: string;
  // otpauth:// URI issuer — shown in the user's authenticator app next to
  // the account label ("Kumiko: jane@example.com").
  readonly issuer: string;
};

export type BindMfaRevokeAllOtherSessions = (
  revoker: (userId: string, currentSid: string | undefined) => Promise<number>,
) => void;

export function createAuthMfaFeature(opts: AuthMfaFeatureOptions): FeatureDefinition {
  return defineFeature("auth-mfa", (r) => {
    r.describe(
      "TOTP-based two-factor authentication: enable/disable flow with QR-code setup, 8 single-use recovery codes, and (once wired into a login flow) a second login step after password verification. Secrets are envelope-encrypted at rest via the same MasterKeyProvider as `secrets`/`config`.",
    );
    r.uiHints({
      displayLabel: "2FA / TOTP",
      category: "identity",
      recommended: true,
    });
    r.requires("user");

    r.entity("user-mfa", userMfaEntity);

    // Late-bound by run-prod-app once the sessions feature (if mounted) has
    // produced a concrete `sessionRevokeAllOthers` callback — mirrors
    // sessions' own bindAutoRevokeOnPasswordChange. Shared by every handler
    // that changes MFA state (enable/disable/regenerate), so each one's
    // "log out every other session" behavior tracks the same wiring.
    let revokeAllOtherSessions:
      | ((userId: string, currentSid: string | undefined) => Promise<number>)
      | undefined;
    const sharedRevoker = (userId: string, currentSid: string | undefined): Promise<number> =>
      revokeAllOtherSessions?.(userId, currentSid) ?? Promise.resolve(0);

    const handlers = {
      enableStart: r.writeHandler(
        createEnableStartHandler({ setupTokenSecret: opts.setupTokenSecret, issuer: opts.issuer }),
      ),
      enableConfirm: r.writeHandler(
        createEnableConfirmHandler({
          setupTokenSecret: opts.setupTokenSecret,
          revokeAllOtherSessions: sharedRevoker,
        }),
      ),
      disable: r.writeHandler(createDisableHandler({ revokeAllOtherSessions: sharedRevoker })),
      regenerateRecovery: r.writeHandler(
        createRegenerateRecoveryHandler({ revokeAllOtherSessions: sharedRevoker }),
      ),
    };

    const bindRevokeAllOtherSessions: BindMfaRevokeAllOtherSessions = (revoker) => {
      revokeAllOtherSessions = revoker;
    };

    return { handlers, bindRevokeAllOtherSessions };
  });
}
