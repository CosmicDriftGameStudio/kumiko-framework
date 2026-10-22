import type { Context, Hono } from "hono";
import * as z from "zod";
import { createAnonymousUser } from "../engine/system-user.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/index.ts";
import { NotFoundError } from "../errors/index.ts";
import { createFallbackLogger } from "../logging/utils.ts";
import type { Dispatcher } from "../pipeline/dispatcher.ts";

const log = createFallbackLogger("kumiko");

// 429 comes from the per-route rate limit; handler errors map to the rest.
export type PublicAuthErrorStatus = 400 | 401 | 403 | 422 | 429 | 500;

// Content is checked where the mail link is built (bundled-features knows the path rules); a bad
// value must never void the whole body, or the request would silently send no mail.
const returnToField = z.string().max(2048).optional().catch(undefined);

// Cross-device try-first handover: an optional tenant-handover grant the signup-request
// route forwards to the handler for server-side verification and binding —
// the grant itself never appears anywhere else (URL, mail, log, response).
export const SignupRequestBody = z.object({
  email: z.email(),
  handover: z
    .object({
      entityType: z.string().min(1).max(200),
      token: z.string().min(1).max(4096),
    })
    .optional(),
  returnTo: returnToField,
});

// Shape guard for "handler not registered" — the only legitimate reason to
// fall back to a single-tenant reply on /auth/tenants or /auth/switch-tenant.
// Every other error (DB down, revoker throws, access denied, …) has to
// propagate — otherwise we'd silently paper over outages.
export function isUnknownHandlerError(e: unknown): boolean {
  if (!(e instanceof NotFoundError)) return false;
  // @cast-boundary error-details — KumikoError.details shape is per-error
  const details = e.details as { entity?: string } | undefined;
  return details?.entity === "handler";
}

export type PendingMfaStep =
  | { kind: "mfa-challenge"; challengeToken: string }
  | { kind: "mfa-setup-required"; preauthSetupToken: string };

export function pendingMfaStepResponse(
  c: Context,
  step: PendingMfaStep,
  landing: { readonly landingPath?: string } = {},
): Response {
  if (step.kind === "mfa-setup-required") {
    return c.json({
      isSuccess: true,
      mfaSetupRequired: true,
      preauthSetupToken: step.preauthSetupToken,
      ...landing,
    });
  }
  return c.json({
    isSuccess: true,
    mfaRequired: true,
    challengeToken: step.challengeToken,
    ...landing,
  });
}

// --- shared route builders for token flows ---------------------------------
// Password-reset, email-verification and signup share the exact same request
// HTTP-shape: parse body → dispatch the request handler → always-200 (no
// enumeration). The handler mints the token AND dispatches the magic-link mail
// via delivery (ctx.notify); the route never sees the token. confirm-route
// validates the token + does the state change → typed failure or 200. Keeping
// the silent-success invariant in one place means changing how the framework
// handles "invalid_body" on a public token endpoint is one edit, not three.

export function registerTokenRequestRoute(opts: {
  api: Hono;
  dispatcher: Dispatcher;
  path: string;
  requestHandler: string;
  // reset/verify/unlock keep the plain RequestTokenBody; signup passes its
  // own schema (adds an optional `handover`, see SignupRequestBody above)
  // so the extra field reaches the handler instead of being parsed away.
  schema?: typeof RequestTokenBody | typeof SignupRequestBody;
}): void {
  const body = opts.schema ?? RequestTokenBody;
  opts.api.post(opts.path, async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = body.safeParse(raw);
    // Malformed body → silent success. A probing client mustn't learn
    // anything from the shape of their input.
    if (!parsed.success) return c.json({ isSuccess: true });

    // The handler dispatches the magic-link mail via delivery before returning.
    // Handler-level failures (misconfiguration, e.g. no RateLimitResolver) stay
    // out of the response so it is uniform for unknown vs. known emails, but
    // they are logged — otherwise the mail silently never goes out. No email in
    // the log line (PII).
    const result = await opts.dispatcher.write(
      opts.requestHandler,
      parsed.data,
      createAnonymousUser(SYSTEM_TENANT_ID),
    );
    // rate_limited is an expected, attacker-triggerable outcome; logging it
    // would flood the sink and bury real misconfiguration errors.
    if (!result.isSuccess && result.error.code !== "rate_limited") {
      log.error("token request handler failed", {
        handler: opts.requestHandler,
        code: result.error.code,
      });
    }

    return c.json({ isSuccess: true });
  });
}

// Shared request-body shape for request-password-reset + request-email-
// verification. Extracted so the two flows stay in sync when the schema
// gains optional fields (locale, deviceId, …).
const RequestTokenBody = z.object({
  email: z.email(),
  returnTo: returnToField,
});
