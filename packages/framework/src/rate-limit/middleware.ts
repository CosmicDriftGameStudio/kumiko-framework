import type { Context, MiddlewareHandler } from "hono";
import { isAuthRateLimitExempt } from "../api/api-constants.js";
import {
  type ClientIpResolver,
  clientIpSourceFromHonoContext,
  createClientIpResolver,
} from "../api/client-ip.js";
import { requestContext } from "../api/request-context.js";
import type { HttpRouteRateLimit } from "../engine/types/http-route.js";
import { RateLimitError, serializeError } from "../errors/index.js";
import type { RateLimitDecision, RateLimitResolver } from "./resolver.js";

// Hono middleware factories for L1 (Global-IP) and L2 (Auth-Endpoints).
//
// Both share the same response shape on 429 — RFC 6585 status, the
// X-RateLimit-* headers IETF draft uses, and a structured JSON body
// produced by the central serializeError() so L1/L2/L3 share the
// `error.code`, `i18nKey`, `details`, `requestId`, `timestamp` envelope.
//
// Fail-mode policy (from docs/plans/features/core-rate-limiting.md):
//   L1/L2 — **fail-closed** when Redis is down. The caller is most
//           likely an attacker; refusing service is safer than letting
//           an unbounded flood through.
//   L3   — fail-open (handled in dispatcher path). App availability
//           wins for known heavy handlers when Redis blips.

export type GlobalIpRateLimitOptions = {
  readonly resolver: RateLimitResolver;
  readonly limit?: number;
  readonly windowSeconds?: number;
  // Number of trusted reverse-proxy hops for the default client-IP
  // resolver — see createClientIpResolver. Ignored when `extractIp` is set.
  // Default 0 (no proxy trusted).
  readonly trustedProxyHops?: number;
  // Shared resolver instance from buildServer — takes precedence over
  // `trustedProxyHops` so the whole server has exactly one resolver (and
  // one warn-once flag) rather than one per middleware.
  // Only standalone callers (no buildServer) should rely on `trustedProxyHops`.
  readonly clientIpResolver?: ClientIpResolver;
  // Override IP extraction — useful when behind a non-standard proxy.
  // Default: the shared resolveClientIp, honoring `trustedProxyHops`.
  readonly extractIp?: (c: Context) => string | undefined;
  // Hook for ops logging when fail-closed fires (Redis down). Default:
  // emits to console.error so the misbehaviour is loud at minimum.
  readonly onFailClosed?: (err: unknown) => void;
};

export function globalIpRateLimit(opts: GlobalIpRateLimitOptions): MiddlewareHandler {
  const limit = opts.limit ?? 1000;
  const windowSeconds = opts.windowSeconds ?? 60;
  const clientIpResolver =
    opts.clientIpResolver ??
    createClientIpResolver(opts.trustedProxyHops ?? 0, "globalIpRateLimit");
  const extractIp =
    opts.extractIp ?? ((c) => clientIpResolver.resolve(clientIpSourceFromHonoContext(c)));
  const onFailClosed = opts.onFailClosed ?? defaultOnFailClosed("l1-global-ip");

  return async (c, next) => {
    const ip = extractIp(c);
    if (!ip) {
      // No IP and no override → can't bucket. Pass-through; deployments
      // that care about that hardening should pin extractIp explicitly.
      return next();
    }

    try {
      const decision = await opts.resolver.check(`l1:${ip}`, { limit, windowSeconds });
      if (!decision.allowed) {
        return respondRateLimited(c, decision, `l1:${ip}`);
      }
      setRateLimitHeaders(c, decision);
    } catch (e) {
      // Fail-closed: refuse rather than let a flood through with no cap.
      // resolver.check never throws RateLimitError (only enforce does),
      // so any throw here is an infrastructure failure (Redis down).
      onFailClosed(e);
      return c.json(
        { error: { code: "rate_limit_unavailable", message: "Rate limiter unavailable" } },
        503,
      );
    }
    await next();
  };
}

export type HttpRouteRateLimitOptions = {
  readonly resolver: RateLimitResolver;
  readonly rateLimit: HttpRouteRateLimit;
  // "METHOD path" — the bucket scope for per: "ip+handler".
  readonly routeKey: string;
  readonly clientIpResolver: ClientIpResolver;
  readonly onFailClosed?: (err: unknown) => void;
};

// Per-route limit for r.httpRoute({ rateLimit }). Fail-closed like L1: these
// routes are anonymous, so an outage must not turn into an unbounded flood.
export function httpRouteRateLimit(opts: HttpRouteRateLimitOptions): MiddlewareHandler {
  const { rateLimit, routeKey } = opts;
  const onFailClosed = opts.onFailClosed ?? defaultOnFailClosed("http-route");
  const config = {
    limit: rateLimit.limit,
    windowSeconds: rateLimit.windowSeconds,
    ...(rateLimit.cost !== undefined && { cost: rateLimit.cost }),
  };

  return async (c, next) => {
    const ip = opts.clientIpResolver.resolve(clientIpSourceFromHonoContext(c));
    if (!ip) return next();
    const bucket = rateLimit.per === "ip" ? `http:${ip}` : `http:${ip}:${routeKey}`;
    try {
      const decision = await opts.resolver.check(bucket, config);
      if (!decision.allowed) return respondRateLimited(c, decision, bucket);
      setRateLimitHeaders(c, decision);
    } catch (e) {
      onFailClosed(e);
      return c.json(
        { error: { code: "rate_limit_unavailable", message: "Rate limiter unavailable" } },
        503,
      );
    }
    await next();
  };
}

export type AuthEndpointRateLimitOptions = {
  readonly resolver: RateLimitResolver;
  readonly limit?: number;
  readonly windowSeconds?: number;
  // Optional target extractor for account-aware bucketing. When set,
  // the bucket key is `l2:${ip}:${target}` — adds account isolation on
  // top of IP. Default: bucket on `l2:${ip}:${path}` (IP + route),
  // which catches naive IP-flood without consuming the request body.
  readonly extractTarget?: (c: Context) => string | undefined | Promise<string | undefined>;
  // Number of trusted reverse-proxy hops for the default client-IP
  // resolver — see createClientIpResolver. Ignored when `extractIp` is set.
  // Default 0 (no proxy trusted).
  readonly trustedProxyHops?: number;
  // See GlobalIpRateLimitOptions.clientIpResolver — same single-resolver
  // rationale.
  readonly clientIpResolver?: ClientIpResolver;
  readonly extractIp?: (c: Context) => string | undefined;
  readonly onFailClosed?: (err: unknown) => void;
};

export function authEndpointRateLimit(opts: AuthEndpointRateLimitOptions): MiddlewareHandler {
  const limit = opts.limit ?? 5;
  const windowSeconds = opts.windowSeconds ?? 60;
  const clientIpResolver =
    opts.clientIpResolver ??
    createClientIpResolver(opts.trustedProxyHops ?? 0, "authEndpointRateLimit");
  const extractIp =
    opts.extractIp ?? ((c) => clientIpResolver.resolve(clientIpSourceFromHonoContext(c)));
  const extractTarget = opts.extractTarget;
  const onFailClosed = opts.onFailClosed ?? defaultOnFailClosed("l2-auth-endpoints");

  return async (c, next) => {
    if (isAuthRateLimitExempt(c.req.method, c.req.path)) return next();

    const ip = extractIp(c);
    if (!ip) return next();

    const target = (await extractTarget?.(c)) ?? c.req.path;
    const bucket = `l2:${ip}:${target}`;

    try {
      const decision = await opts.resolver.check(bucket, { limit, windowSeconds });
      if (!decision.allowed) {
        return respondRateLimited(c, decision, bucket);
      }
      setRateLimitHeaders(c, decision);
    } catch (e) {
      onFailClosed(e);
      return c.json(
        { error: { code: "rate_limit_unavailable", message: "Rate limiter unavailable" } },
        503,
      );
    }
    await next();
  };
}

function defaultOnFailClosed(label: string): (err: unknown) => void {
  return (err) => {
    // Loud by default — fail-closed for an unknown reason is an ops
    // signal, not something to swallow silently. Production deploys
    // override this with a structured logger; the default keeps the
    // noise visible if no logger is wired.
    // biome-ignore lint/suspicious/noConsole: ops-visible fallback when no logger is wired
    console.error(`[rate-limit ${label}] fail-closed (refusing request):`, err);
  };
}

function setRateLimitHeaders(c: Context, decision: RateLimitDecision): void {
  c.header("X-RateLimit-Limit", String(decision.limit));
  c.header("X-RateLimit-Remaining", String(decision.remaining));
  // Unix-epoch seconds — matches the de-facto industry standard (GitHub,
  // Twitter, AWS) and stays consistent with Retry-After, which is also
  // seconds. Previously this emitted an ISO-Instant string; proxies and
  // client libs that parse as integer would silently see NaN.
  c.header("X-RateLimit-Reset", String(Math.floor(decision.resetAt.epochMilliseconds / 1000)));
}

function respondRateLimited(c: Context, decision: RateLimitDecision, bucket: string): Response {
  // Build a RateLimitError so the wire shape is identical to the L3
  // dispatcher path. serializeError adds i18nKey, requestId, timestamp —
  // fields a hand-rolled body would silently miss.
  const err = new RateLimitError({
    bucket,
    limit: decision.limit,
    windowSeconds: decision.windowSeconds,
    remaining: decision.remaining,
    retryAfterSeconds: decision.retryAfterSeconds,
    resetAt: decision.resetAt.toString(),
  });
  c.header("Retry-After", String(Math.max(1, decision.retryAfterSeconds)));
  setRateLimitHeaders(c, decision);
  const reqId = requestContext.get()?.requestId;
  return c.json(serializeError(err, reqId), 429);
}
