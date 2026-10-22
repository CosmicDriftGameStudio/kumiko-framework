import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { USER_STATUS, userTable } from "../../user/index.ts";
import { signDeletionToken } from "../deletion-token.ts";
import { updateUserLifecycle } from "../lib/update-user-lifecycle.ts";

// Verification-link TTL: 60 minutes — long enough for an email round trip,
// but short enough that an intercepted link does not remain valid indefinitely.
const DELETION_VERIFY_TTL_MINUTES = 60;

// Sends the Apex magic link for an anonymous deletion request. The handler
// does NOT return the link (content-enumeration safety); it invokes the
// callback directly, analogous to sendDeletionRequestedEmail.
//
// IMPORTANT (timing oracle): The callback MUST be non-blocking (enqueue, e.g.
// delivery.notify / Job), not send synchronously. It runs only for an
// existing active user; a synchronous send makes response latency measurably
// longer for real accounts than for nonexistent ones, enabling enumeration by
// timing. A fast enqueue effectively equalizes this.
// Complete timing equalization (always performing equivalent work) is deferred.
export type SendDeletionVerificationEmailFn = (args: {
  readonly email: string;
  readonly verifyUrl: string;
  readonly expiresAt: string;
}) => Promise<void>;

export type RequestDeletionByEmailOptions = {
  /** HMAC secret used to sign the verification token. Without a secret, the flow
   *  is disabled (the handler silently responds with success and no link). */
  readonly deletionTokenSecret?: string;
  /** Base URL of the Apex confirmation screen, e.g.
   *  "https://app.example.com/delete-account/confirm". The handler appends the
   *  token as a URL fragment (`#token=<token>`). Without a URL, no link is sent. */
  readonly deletionVerifyUrl?: string;
  readonly sendDeletionVerificationEmail?: SendDeletionVerificationEmailFn;
};

// Token goes in the URL fragment, not a query param — fragments never leave
// the browser (not sent to the server, so they never land in proxy/access
// logs, unlike `?token=`). Same convention as the export-download link
// (feature.ts). Preserves any existing query params on `base`
// (`?lang=de` stays a query param; only the token is a fragment).
const APPEND_LIFECYCLE_EVENT_REASON =
  "appends the user lifecycle event on the SYSTEM_TENANT_ID user stream";

export function buildDeletionVerifyUrl(base: string, token: string): string {
  const url = new URL(base);
  url.hash = `token=${encodeURIComponent(token)}`;
  return url.toString();
}

// Anonymous Apex flow step 1: request account deletion by email.
// This is especially relevant for GDPR when the user can no longer log in
// (lockout). Email → magic link → confirm-deletion-by-token.
//
// Enumeration-safe (content): always returns the same success shape,
// regardless of whether the email exists, the user is active, or the flow is
// configured. A link is generated only for an existing, active user.
// Timing safety depends on the non-blocking callback (see the type doc above).
export function createRequestDeletionByEmailHandler(opts: RequestDeletionByEmailOptions = {}) {
  return defineWriteHandler({
    name: "request-deletion-by-email",
    schema: z.object({ email: z.email() }),
    access: { roles: ["anonymous", "Member", "User", "TenantAdmin", "SystemAdmin"] },
    description:
      "Mails an account-deletion verification link to the given address, for a user who wants to be erased but can no longer log in; it answers identically whether or not the address belongs to an active account and never returns the link.",
    // Mails a deletion link to any address the caller names.
    agent: { risk: "high" },
    // Defense in depth against email probing on the anonymous endpoint.
    rateLimit: { per: "ip+handler", limit: 10, windowSeconds: 60 },
    escapeHatch: {
      grants: ["unsafeRaw", "globalWrites"],
      reason: APPEND_LIFECYCLE_EVENT_REASON,
    },
    handler: async (event, ctx) => {
      const success = { isSuccess: true as const, data: { kind: "requested" as const } };

      // Safe when not configured: without a secret or URL, no link is sent, but the response is
      // unchanged.
      if (!opts.deletionTokenSecret || !opts.deletionVerifyUrl) return success;

      const userRow = await ctx.db
        .global(userTable)
        .fetchOne<{ id: string; status: string; email: string }>({
          email: event.payload.email,
          isDeleted: false,
        });
      if (!userRow || userRow["status"] !== USER_STATUS.Active || !userRow["email"]) {
        return success;
      }

      // Replay protection: each request gets a fresh requestId, which is stored on
      // the user row and incorporated into the token HMAC purpose. cancel
      // nulls it, so a token replayed after cancellation no longer verifies.
      const requestId = crypto.randomUUID();
      await updateUserLifecycle(ctx.db.unsafeRaw(), userRow["id"], {
        pendingDeletionRequestId: requestId,
      });

      const { token, expiresAt } = signDeletionToken(
        userRow["id"],
        requestId,
        DELETION_VERIFY_TTL_MINUTES,
        opts.deletionTokenSecret,
      );
      const verifyUrl = buildDeletionVerifyUrl(opts.deletionVerifyUrl, token);

      if (opts.sendDeletionVerificationEmail) {
        try {
          await opts.sendDeletionVerificationEmail({
            // Row value is ciphertext with an active KMS; the lookup above
            // only matches byte-exact, so the payload IS the stored plaintext.
            email: event.payload.email,
            verifyUrl,
            expiresAt: expiresAt.toString(),
          });
        } catch (err) {
          // biome-ignore lint/suspicious/noConsole: operator-visibility for email-send-failure
          console.warn(
            `[user-data-rights:request-deletion-by-email] send failed err=${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      return success;
    },
  });
}
