import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { HandlerContext, SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { MFA_CHALLENGE_TOKEN_TTL_MINUTES } from "./constants";
import { findUserMfaRow } from "./db/queries";
import { signMfaChallengeToken } from "./mfa-challenge-token";

export type MfaStatusCheckResult =
  | { readonly required: false }
  | { readonly required: true; readonly challengeToken: string };

// Consumed by auth-email-password's login.write.ts via `mfaStatusChecker`
// (a generic callback type declared THERE, not here — auth-email-password
// must not import auth-mfa's config, only the shape). Existence-only for
// now: "has this user enabled MFA" — tenant-wide enforcement policy
// ("all logins in this tenant require MFA") is a separate, later step.
export type MfaStatusChecker = (
  ctx: HandlerContext,
  userId: string,
  tenantId: TenantId,
) => Promise<MfaStatusCheckResult>;

export function createMfaStatusChecker(opts: {
  readonly challengeTokenSecret: string;
}): MfaStatusChecker {
  return async (ctx, userId, tenantId) => {
    const scopedDb = createTenantDb(ctx.db.raw, tenantId, "system");
    const scopedUser: SessionUser = { id: userId, tenantId, roles: ["User"] };
    const row = await findUserMfaRow(scopedDb, scopedUser);
    if (!row) return { required: false };

    const { token } = signMfaChallengeToken(
      { userId, tenantId },
      MFA_CHALLENGE_TOKEN_TTL_MINUTES,
      opts.challengeTokenSecret,
    );
    return { required: true, challengeToken: token };
  };
}
