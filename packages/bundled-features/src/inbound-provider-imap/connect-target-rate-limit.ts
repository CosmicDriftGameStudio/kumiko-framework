// The handlers' own `rateLimit` counts per tenant, so many tenants could probe one foreign mail
// host (login oracle, port scan). These buckets are keyed by the target and count across tenants.
// Trade-off: tokens are booked before the login attempt and the limiter has no refund, so a
// tenant admin can exhaust a foreign host+user bucket; the oracle protection is the weightier risk.

import { InternalError, isKumikoError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import type {
  BeforeTransactionContext,
  BeforeTransactionResult,
} from "@cosmicdrift/kumiko-types/handlers";
import type { ImapCredentialDocument } from "./credential-document.ts";

const TARGET_WINDOW_SECONDS = 600;
const PER_HOST_LIMIT = 200;
const PER_HOST_AND_USER_LIMIT = 20;

export async function enforceConnectTargetLimit(
  ctx: Pick<BeforeTransactionContext, "services" | "rateLimitDigest">,
  doc: ImapCredentialDocument,
): Promise<BeforeTransactionResult<null>> {
  const { rateLimit } = ctx.services;
  const digest = ctx.rateLimitDigest;
  if (!rateLimit || !digest) {
    throw new InternalError({
      message: "inbound-provider-imap connect checks need a rate limiter and a digest key",
    });
  }
  // Trailing dot is the same DNS name; without stripping it `imap.x.com.` would get its own buckets.
  const host = doc.host.toLowerCase().replace(/\.+$/, "");
  try {
    await rateLimit.enforceAll([
      {
        bucket: `imap-connect-host:${digest(host)}`,
        config: { limit: PER_HOST_LIMIT, windowSeconds: TARGET_WINDOW_SECONDS },
      },
      {
        bucket: `imap-connect-host-user:${digest(`${host}\n${doc.user.toLowerCase()}`)}`,
        config: { limit: PER_HOST_AND_USER_LIMIT, windowSeconds: TARGET_WINDOW_SECONDS },
      },
    ]);
  } catch (error) {
    if (isKumikoError(error)) return writeFailure(error);
    throw error;
  }
  return { isSuccess: true, data: null };
}
