import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  type HandlerContext,
  type SessionUser,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { type MfaRequiredPolicy, mfaRequiredConfigHandle, mfaRequiredConfigKey } from "./config";
import { MFA_CHALLENGE_TOKEN_TTL_MINUTES, MFA_PREAUTH_SETUP_TOKEN_TTL_MINUTES } from "./constants";
import { findUserMfaRow } from "./db/queries";
import { signMfaChallengeToken } from "./mfa-challenge-token";
import { signMfaPreauthSetupToken } from "./mfa-preauth-setup-token";

export type MfaStatusCheckResult =
  | { readonly required: false }
  | { readonly required: true; readonly challengeToken: string }
  // Enforcement policy demands MFA for this user, but they haven't enrolled
  // yet. Distinct from `required: true` (which means "enrolled, prove it
  // now") — see config.ts's ponytail note on why this hard-blocks login
  // with no in-band recovery until PR3's enrollment-during-login UI ships.
  | { readonly setupRequired: true; readonly preauthSetupToken: string };

// Consumed by auth-email-password's login.write.ts via `mfaStatusChecker`
// (a generic callback type declared THERE, not here — auth-email-password
// must not import auth-mfa's config, only the shape).
export type MfaStatusChecker = (
  ctx: HandlerContext,
  userId: string,
  tenantId: TenantId,
  // Merged global+tenant roles — needed to evaluate the "admins" policy
  // value. Must be the MERGED set (see login.write.ts caller): a
  // SystemAdmin whose admin-ness lives only in global roles would be
  // missed if the caller passed tenant-membership roles alone.
  roles: readonly string[],
) => Promise<MfaStatusCheckResult>;

export function createMfaStatusChecker(opts: {
  readonly challengeTokenSecret: string;
}): MfaStatusChecker {
  return async (ctx, userId, tenantId, roles) => {
    const scopedDb = createTenantDb(ctx.db.raw, tenantId, "system");
    const scopedUser: SessionUser = { id: userId, tenantId, roles: ["User"] };
    const row = await findUserMfaRow(scopedDb, scopedUser);

    if (row) {
      // Enrolled — always enforce regardless of policy. The user opted in
      // themselves; policy only governs whether enrollment is MANDATORY
      // for those who haven't.
      const { token } = signMfaChallengeToken(
        { userId, tenantId },
        MFA_CHALLENGE_TOKEN_TTL_MINUTES,
        opts.challengeTokenSecret,
      );
      return { required: true, challengeToken: token };
    }

    // ctx.config is bound to the CALLING user's tenant (GUEST_USER for
    // login) — wrong tenant here. ctx.configResolver takes tenantId
    // explicitly, which is what a pre-session check against the LOGGING-IN
    // user's tenant needs.
    // @cast-boundary engine-payload — "select" config values are validated
    // against the declared `options` at write-time by the config feature.
    const policy = ((await ctx.configResolver?.get(
      mfaRequiredConfigHandle.name,
      mfaRequiredConfigKey(),
      tenantId,
      userId,
      scopedDb,
    )) ?? "optional") as MfaRequiredPolicy | "optional";
    if (policy === "optional") return { required: false };
    const buildSetupToken = (): string =>
      signMfaPreauthSetupToken(
        { userId, tenantId },
        MFA_PREAUTH_SETUP_TOKEN_TTL_MINUTES,
        opts.challengeTokenSecret,
      ).token;
    if (policy === "all") return { setupRequired: true, preauthSetupToken: buildSetupToken() };
    // policy === "admins"
    const isAdmin = roles.some((role) => access.admin.includes(role));
    return isAdmin
      ? { setupRequired: true, preauthSetupToken: buildSetupToken() }
      : { required: false };
  };
}
