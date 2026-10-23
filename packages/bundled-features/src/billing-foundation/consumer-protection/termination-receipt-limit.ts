import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { normalizePayloadBucketValue } from "@cosmicdrift/kumiko-framework/pipeline";

// The declaration itself is a statutory duty and is never refused. Only the
// receipt mail is capped, so the endpoint cannot be used to mail one inbox
// from the operator's sender domain.
export const RECEIPT_MAILS_PER_RECIPIENT = 3;
export const RECEIPT_WINDOW_SECONDS = 24 * 60 * 60;

const RECEIPT_BUCKET_PREFIX = "termination-receipt";

function receiptBucketKey(ctx: HandlerContext, email: string): string | undefined {
  const digest = ctx.rateLimitDigest?.(normalizePayloadBucketValue(email, "email"));
  return digest === undefined ? undefined : `${RECEIPT_BUCKET_PREFIX}:${digest}`;
}

export type ReceiptMailVerdict = "allowed" | "limited" | "unavailable";

/** Consumes one receipt token for the recipient. Fails closed when the limiter
 *  errors or no digest key is wired ("unavailable"): the declaration is already
 *  recorded, a missing receipt is the lesser harm. */
export async function mayMailReceipt(
  ctx: HandlerContext,
  email: string,
): Promise<ReceiptMailVerdict> {
  // skip: no rate limiter wired, nothing to count against
  if (!ctx.rateLimit) return "allowed";
  try {
    const bucketKey = receiptBucketKey(ctx, email);
    if (bucketKey === undefined) {
      ctx.obs.log?.warn(
        "[billing-foundation:termination] no rate-limit digest available, receipt mail withheld",
      );
      return "unavailable";
    }
    const decision = await ctx.rateLimit.check(bucketKey, {
      limit: RECEIPT_MAILS_PER_RECIPIENT,
      windowSeconds: RECEIPT_WINDOW_SECONDS,
    });
    return decision.allowed ? "allowed" : "limited";
  } catch (error) {
    ctx.obs.log?.warn(
      `[billing-foundation:termination] receipt rate limiter failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return "unavailable";
  }
}
