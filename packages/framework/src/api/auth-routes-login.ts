import * as z from "zod";
import { createAnonymousUser } from "../engine/system-user.ts";
import type { SessionUser } from "../engine/types/index.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/index.ts";
import { Routes } from "./api-constants.ts";
import { inMemoryLoginRateLimiterFallback } from "./auth-rate-limiters.ts";
import type { AuthRouteContext } from "./auth-routes-context.ts";
import type { PublicAuthErrorStatus } from "./auth-routes-shared.ts";

// Body schema for POST /auth/login. Enforced BEFORE rate-limit so that a
// malformed body (`email: 42`, missing password, …) returns 400 instead of
// crashing on `.toLowerCase()` and leaking a 500 that never increments the
// login counter — previous wiring let attackers spam the endpoint without
// tripping the bucket.
const LoginBody = z.object({
  email: z.string().min(1),
  password: z.string(),
});

export function registerLoginRoute(ctx: AuthRouteContext): void {
  const { api, dispatcher, config, getClientIp, mintSessionAndRespond, landingPathFragment } = ctx;
  // POST /auth/login — public endpoint (bypasses auth middleware via PUBLIC_API_PATHS).
  // The configured login handler authenticates and returns a SessionUser;
  // the route signs the JWT and hands it back to the client.
  if (config.loginHandler) {
    const loginQn = config.loginHandler;
    const statusMap = config.loginErrorStatusMap ?? {};
    // Default to in-memory limiter unless the caller opted out via null.
    const rateLimiter =
      config.loginRateLimit === null
        ? null
        : (config.loginRateLimit ?? inMemoryLoginRateLimiterFallback());

    api.post(Routes.authLogin, async (c) => {
      const raw = await c.req.json().catch(() => null);
      const parsed = LoginBody.safeParse(raw);
      if (!parsed.success) {
        return c.json({ isSuccess: false, error: "invalid_body" }, 400);
      }
      const body = parsed.data;

      const clientIp = getClientIp(c);
      const rateLimitKey = `${clientIp}|${body.email.toLowerCase()}`;

      if (rateLimiter) {
        // Bucket by both IP and email so a single guessed password can't
        // block a real user from logging in, but also so one abuser can't
        // just cycle emails.
        const allowed = await rateLimiter.check(rateLimitKey);
        if (!allowed) {
          return c.json({ isSuccess: false, error: "rate_limited" }, 429);
        }
      }

      const result = await dispatcher.write(loginQn, body, createAnonymousUser(SYSTEM_TENANT_ID));

      if (!result.isSuccess) {
        // Feature-specific auth reason codes arrive via UnprocessableError.details.reason
        // (e.g. "invalid_credentials", "user_locked"). Fall back to the KumikoError code
        // so unmapped cases still get a sensible status.
        // @cast-boundary error-details — KumikoError.details shape is per-error
        const reason =
          (result.error.details as { reason?: string } | undefined)?.reason ?? result.error.code;
        // @cast-boundary engine-payload — statusMap value union narrows to the http-status union
        const status = (statusMap[reason] ?? result.error.httpStatus) as PublicAuthErrorStatus;
        return c.json({ isSuccess: false, error: result.error }, status);
      }

      // @cast-boundary engine-payload — generic dispatcher.write result for
      // login. Three possible shapes: a straight session, an MFA challenge
      // when the loginHandler is wired with a second-factor gate, or a hard
      // block when enforcement policy demands MFA but the user never
      // enrolled (see auth-mfa's config.ts for why this has no in-band
      // recovery yet).
      const data = result.data as
        | { kind: "auth-session"; session: SessionUser }
        | { kind: "mfa-challenge"; challengeToken: string }
        | { kind: "mfa-setup-required"; preauthSetupToken: string };

      if (data.kind === "mfa-setup-required") {
        // No session, no challenge — the client must show an
        // enrollment-required message. No rate-limit reset (same reasoning
        // as the mfa-challenge branch below).
        return c.json({
          isSuccess: true,
          mfaSetupRequired: true,
          preauthSetupToken: data.preauthSetupToken,
        });
      }

      if (data.kind === "mfa-challenge") {
        // No session minted yet — no cookies, no token. The client must
        // complete /auth/mfa/verify with this token before it gets either.
        // Rate-limit counter is NOT reset here: a "correct password, wrong/
        // no TOTP yet" outcome hasn't proven the caller owns the account any
        // more than a wrong password did.
        return c.json({ isSuccess: true, mfaRequired: true, challengeToken: data.challengeToken });
      }

      // Session creation (optional) + JWT sign + cookies — see
      // mintSessionAndRespond. Creating the session BEFORE signing the JWT
      // is load-bearing: the sid must exist on the server before the token
      // that references it can be handed out, otherwise a fast client could
      // arrive at an auth-middleware check before the insert commits.
      const token = await mintSessionAndRespond(c, data.session);
      const landingPath = landingPathFragment({
        flow: "login",
        roles: data.session.roles,
        tenantId: data.session.tenantId,
      });

      if (rateLimiter) {
        await rateLimiter.reset(rateLimitKey);
      }

      return c.json({
        isSuccess: true,
        token,
        user: { id: data.session.id, tenantId: data.session.tenantId, roles: data.session.roles },
        ...landingPath,
      });
    });
  }
}
