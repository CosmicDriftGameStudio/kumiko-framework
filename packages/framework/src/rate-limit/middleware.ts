import type { Context, MiddlewareHandler } from "hono";
import { RateLimitError } from "../errors";
import type { RateLimitConfig, RateLimitDecision, RateLimitResolver } from "./resolver";

// Hono middleware factories for L1 (Global-IP) and L2 (Auth-Endpoints).
//
// Both share the same response shape on 429 — RFC 6585 status, the
// X-RateLimit-* headers IETF draft uses, and a structured JSON body
// matching the L3 dispatcher path (RateLimitError details).
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
  // Override IP extraction — useful when behind a non-standard proxy.
  // Default: x-forwarded-for first hop.
  readonly extractIp?: (c: Context) => string | undefined;
  // Hook for ops logging when fail-closed fires (Redis down). Default:
  // emits to console.error so the misbehaviour is loud at minimum.
  readonly onFailClosed?: (err: unknown) => void;
};

export function globalIpRateLimit(opts: GlobalIpRateLimitOptions): MiddlewareHandler {
  const limit = opts.limit ?? 1000;
  const windowSeconds = opts.windowSeconds ?? 60;
  const extractIp = opts.extractIp ?? defaultExtractIp;
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
        return rateLimit429(c, decision, `l1:${ip}`);
      }
      setRateLimitHeaders(c, decision);
    } catch (e) {
      if (e instanceof RateLimitError) {
        return rateLimit429(c, decisionFromError(e), e.details.bucket);
      }
      // Fail-closed: refuse rather than let a flood through with no cap.
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
  readonly extractIp?: (c: Context) => string | undefined;
  readonly onFailClosed?: (err: unknown) => void;
};

export function authEndpointRateLimit(opts: AuthEndpointRateLimitOptions): MiddlewareHandler {
  const limit = opts.limit ?? 5;
  const windowSeconds = opts.windowSeconds ?? 60;
  const extractIp = opts.extractIp ?? defaultExtractIp;
  const extractTarget = opts.extractTarget;
  const onFailClosed = opts.onFailClosed ?? defaultOnFailClosed("l2-auth-endpoints");

  return async (c, next) => {
    const ip = extractIp(c);
    if (!ip) return next();

    const target = (await extractTarget?.(c)) ?? c.req.path;
    const bucket = `l2:${ip}:${target}`;

    try {
      const decision = await opts.resolver.check(bucket, { limit, windowSeconds });
      if (!decision.allowed) {
        return rateLimit429(c, decision, bucket);
      }
      setRateLimitHeaders(c, decision);
    } catch (e) {
      if (e instanceof RateLimitError) {
        return rateLimit429(c, decisionFromError(e), e.details.bucket);
      }
      onFailClosed(e);
      return c.json(
        { error: { code: "rate_limit_unavailable", message: "Rate limiter unavailable" } },
        503,
      );
    }
    await next();
  };
}

function defaultExtractIp(c: Context): string | undefined {
  const xff = c.req.header("x-forwarded-for");
  return xff?.split(",")[0]?.trim() || undefined;
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
  c.header("X-RateLimit-Reset", decision.resetAt.toString());
}

function rateLimit429(c: Context, decision: RateLimitDecision, bucket: string): Response {
  c.header("Retry-After", String(Math.max(1, decision.retryAfterSeconds)));
  setRateLimitHeaders(c, decision);
  return c.json(
    {
      error: {
        code: "rate_limited",
        message: `rate limited: ${bucket}`,
        details: {
          bucket,
          limit: decision.limit,
          windowSeconds: decision.windowSeconds,
          remaining: decision.remaining,
          retryAfterSeconds: decision.retryAfterSeconds,
          resetAt: decision.resetAt.toString(),
        },
      },
    },
    429,
  );
}

function decisionFromError(err: RateLimitError): RateLimitDecision {
  return {
    allowed: false,
    limit: err.details.limit,
    remaining: err.details.remaining,
    retryAfterSeconds: err.details.retryAfterSeconds,
    windowSeconds: err.details.windowSeconds,
    resetAt: Temporal.Instant.from(err.details.resetAt),
  };
}

// Test/ops helper: fixed config used internally by middleware. Exposed
// via RateLimitConfig type re-export so callers can build their own
// middleware on top of the same primitive.
export type _MiddlewareInternals = { config: RateLimitConfig };
