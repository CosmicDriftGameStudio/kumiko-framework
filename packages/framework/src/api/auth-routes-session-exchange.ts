import * as z from "zod";
import { createAnonymousUser } from "../engine/system-user.ts";
import type { SessionUser } from "../engine/types/index.ts";
import { SYSTEM_TENANT_ID } from "../engine/types/index.ts";
import { createFallbackLogger } from "../logging/utils.ts";
import { Routes } from "./api-constants.ts";
import { inMemoryLoginRateLimiterFallback } from "./auth-rate-limiters.ts";
import type { AuthRouteContext } from "./auth-routes-context.ts";
import { handlerFailureResponse } from "./auth-routes-shared.ts";

const log = createFallbackLogger("session-exchange");

// Parsed before the rate limit so a malformed body cannot bypass the bucket.
const SessionExchangeBody = z.object({
  method: z.string().min(1),
  payload: z.unknown(),
});

// Loose on purpose: optional session fields (claims, sid, timezone) pass through untouched.
const AuthSessionResult = z.object({
  kind: z.literal("auth-session"),
  session: z.looseObject({
    id: z.string(),
    tenantId: z.string(),
    roles: z.array(z.string()),
  }),
});

export function registerSessionExchangeRoute(ctx: AuthRouteContext): void {
  const { api, dispatcher, config, getClientIp, mintSessionAndRespond, landingPathFragment } = ctx;
  const handlers = config.sessionExchangeHandlers;
  if (!handlers || Object.keys(handlers).length === 0) return;

  const statusMap = config.loginErrorStatusMap ?? {};
  const loginLimiter =
    config.loginRateLimit === null
      ? null
      : (config.loginRateLimit ?? inMemoryLoginRateLimiterFallback());
  const rateLimiter =
    config.sessionExchangeRateLimit === undefined ? loginLimiter : config.sessionExchangeRateLimit;

  api.post(Routes.authSessionExchange, async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = SessionExchangeBody.safeParse(raw);
    if (!parsed.success) {
      return c.json({ isSuccess: false, error: "invalid_body" }, 400);
    }
    const { method, payload } = parsed.data;

    // hasOwn: "__proto__" / "toString" must not resolve through the prototype.
    const qn = Object.hasOwn(handlers, method) ? handlers[method] : undefined;
    if (qn === undefined) {
      return c.json({ isSuccess: false, error: "unknown_method" }, 400);
    }

    const rateLimitKey = `${getClientIp(c)}|session-exchange:${method}`;
    let refundSlot: (() => Promise<void>) | undefined;
    if (rateLimiter) {
      const { reserve, refund } = rateLimiter;
      if (reserve && refund) {
        const reservation = await reserve.call(rateLimiter, rateLimitKey);
        if (!reservation.allowed) {
          return c.json({ isSuccess: false, error: "rate_limited" }, 429);
        }
        refundSlot = () => refund.call(rateLimiter, rateLimitKey, reservation.window);
      } else if (!(await rateLimiter.check(rateLimitKey))) {
        return c.json({ isSuccess: false, error: "rate_limited" }, 429);
      }
    }

    const result = await dispatcher.write(qn, payload, createAnonymousUser(SYSTEM_TENANT_ID));

    if (!result.isSuccess) {
      return handlerFailureResponse(c, result.error, statusMap);
    }

    const exchanged = AuthSessionResult.safeParse(result.data);
    if (!exchanged.success) {
      return c.json({ isSuccess: false, error: "invalid_exchange_result" }, 500);
    }
    const session: SessionUser = exchanged.data.session;

    const token = await mintSessionAndRespond(c, session);
    const landingPath = landingPathFragment({
      flow: "login",
      roles: session.roles,
      tenantId: session.tenantId,
    });
    // Refund, not reset: the bucket is per IP and method, so a reset after one's own
    // success would reopen guessing slots taken by others.
    // A failing refund keeps the slot counted: the session is minted, so it must not fail the login.
    try {
      await refundSlot?.();
    } catch (error) {
      log.warn("session-exchange rate-limit refund failed; slot stays counted", { error });
    }

    return c.json({
      isSuccess: true,
      token,
      user: { id: session.id, tenantId: session.tenantId, roles: session.roles },
      ...landingPath,
    });
  });
}
