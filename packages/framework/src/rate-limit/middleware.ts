import type { Context, MiddlewareHandler } from "hono";
import { isAuthRateLimitExempt } from "../api/api-constants.ts";
import {
  type ClientIpResolver,
  clientIpSourceFromHonoContext,
  createClientIpResolver,
} from "../api/client-ip.ts";
import { requestContext } from "../api/request-context.ts";
import type { HttpRouteRateLimit } from "../engine/types/http-route.ts";
import { RateLimitError, serializeError } from "../errors/index.ts";
import { createFallbackLogger } from "../logging/index.ts";
import { emitRateLimitFailOpen } from "../observability/standard-metrics.ts";
import type { Meter } from "../observability/types/index.ts";
import { toPublicBucketName } from "./bucket.ts";
import type { RateLimitDecision, RateLimitResolver } from "./resolver.ts";

// Hono middleware factories for L1 (Global-IP) and L2 (Auth-Endpoints).
//
// Both share the same response shape on 429 — RFC 6585 status, the
// X-RateLimit-* headers IETF draft uses, and a structured JSON body
// produced by the central serializeError() so L1/L2/L3 share the
// `error.code`, `i18nKey`, `details`, `requestId`, `timestamp` envelope.
//
// Fail-mode policy:
//   L1 and http-route — **fail-open** when Redis is down: a cache outage must
//           not take the whole API down. Counted and logged (throttled).
//   L2 (auth endpoints) — **fail-closed**: brute-force protection must hold.
//   L3   — fail-closed (dispatcher path, enforceRateLimit): a Redis
//           failure answers 503 rate_limit_unavailable.

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
  // Hook for ops logging when the limiter let a request through because Redis failed.
  // Default: throttled warn plus the fail-open counter when `meter` is set.
  readonly onFailOpen?: (err: unknown) => void;
  readonly meter?: Meter;
};

// Shared with runProdApp (server-runtime re-exports it). The auth middleware default stays
// stricter than runProdApp's auth limit (30): a bare authEndpointRateLimit guards brute force.
export const DEFAULT_GLOBAL_RATE_LIMIT = { limit: 600, windowSeconds: 60 } as const;

export function globalIpRateLimit(opts: GlobalIpRateLimitOptions): MiddlewareHandler {
  const limit = opts.limit ?? DEFAULT_GLOBAL_RATE_LIMIT.limit;
  const windowSeconds = opts.windowSeconds ?? DEFAULT_GLOBAL_RATE_LIMIT.windowSeconds;
  const clientIpResolver =
    opts.clientIpResolver ??
    createClientIpResolver(opts.trustedProxyHops ?? 0, "globalIpRateLimit");
  const extractIp =
    opts.extractIp ?? ((c) => clientIpResolver.resolve(clientIpSourceFromHonoContext(c)));
  const onFailOpen = opts.onFailOpen ?? createFailOpenReporter("l1-global-ip", opts.meter);

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
      // resolver.check never throws RateLimitError (only enforce does),
      // so any throw here is an infrastructure failure (Redis down).
      onFailOpen(e);
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
  readonly onFailOpen?: (err: unknown) => void;
  readonly meter?: Meter;
};

// Per-route limit for r.httpRoute({ rateLimit }). Fail-open like L1: a Redis outage must not
// take anonymous routes (status pages, webhooks) down with it.
export function httpRouteRateLimit(opts: HttpRouteRateLimitOptions): MiddlewareHandler {
  const { rateLimit, routeKey } = opts;
  const onFailOpen = opts.onFailOpen ?? createFailOpenReporter("http-route", opts.meter);
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
      onFailOpen(e);
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

const FAIL_OPEN_WARN_INTERVAL_MS = 30_000;

export function createFailOpenReporter(
  label: string,
  meter?: Meter,
  now: () => number = Date.now,
): (err: unknown) => void {
  const logger = createFallbackLogger("rate-limit");
  let lastWarnAt: number | undefined;
  return (err) => {
    if (meter) emitRateLimitFailOpen(meter, label);
    const nowMs = now();
    // skip: throttled, the counter above still records every fail-open
    if (lastWarnAt !== undefined && nowMs - lastWarnAt < FAIL_OPEN_WARN_INTERVAL_MS) return;
    lastWarnAt = nowMs;
    logger.warn("rate limiter unavailable, failing open", {
      label,
      // ioredis errors can carry the command args, i.e. the bucket key with IP/target.
      error: err instanceof Error ? err.message : String(err),
    });
  };
}

function defaultOnFailClosed(label: string): (err: unknown) => void {
  return (err) => {
    // Loud by default — fail-closed for an unknown reason is an ops
    // signal, not something to swallow silently. Production deploys
    // override this with a structured logger; the default keeps the
    // noise visible if no logger is wired.
    // biome-ignore lint/suspicious/noConsole: ops-visible fallback when no logger is wired
    console.error(
      `[rate-limit ${label}] fail-closed (refusing request):`,
      // ioredis errors can carry the command args, i.e. the bucket key with IP/target.
      err instanceof Error ? err.message : String(err),
    );
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
    bucket: toPublicBucketName(bucket),
    limit: decision.limit,
    windowSeconds: decision.windowSeconds,
    remaining: decision.remaining,
    retryAfterSeconds: decision.retryAfterSeconds,
    resetAt: decision.resetAt.toString(),
  });
  c.header("Retry-After", String(Math.max(1, decision.retryAfterSeconds)));
  setRateLimitHeaders(c, decision);
  const reqId = requestContext.get()?.requestId;
  return c.json(serializeError(err, reqId, requestContext.get()?.errorDocs), 429);
}
