import type Redis from "ioredis";
import { RateLimitError } from "../errors";
import { RedisKeys } from "../pipeline/redis-keys";

// Token-Bucket rate limiter, atomic via Redis Lua. One round-trip per
// check — the script computes the bucket state inline and either deducts
// or rejects.
//
// Why Token Bucket: bursts are allowed up to `limit`, refill is steady
// at `limit / windowSeconds` per second. Sliding window would be more
// fair but needs more Redis ops; fixed window is simpler but gives 2x
// burst at boundaries. Token Bucket sits in the right trade-off zone.
//
// Storage layout per bucket:
//   <key> hash with two fields:
//     tokens  — float, current tokens in the bucket
//     ts      — last refill timestamp (ms since epoch)
//   TTL = 2 × windowSeconds (long enough to not lose state across refill,
//         short enough to clean up dead buckets)
//
// The Lua script does: load → refill based on elapsed time → check cost
// → deduct or reject. Returns [allowed, remaining, resetAfterMs].

// KEYS[1] — bucket key
// ARGV[1] — limit (max tokens)
// ARGV[2] — refillRatePerMs (limit / (windowSeconds * 1000))
// ARGV[3] — cost (tokens to deduct, default 1)
// ARGV[4] — nowMs (server time, passed in for testability + drift safety)
// ARGV[5] — ttlSeconds (key TTL)
//
// Returns: { allowed (1|0), remainingTokens (int floor), retryAfterMs (int) }
//
// The peek script (TOKEN_BUCKET_PEEK_LUA) below is the same logic minus
// the HMSET — used by ops queries to inspect a bucket without nudging
// the refill timestamp. Two scripts so neither has to grow a "writeback"
// flag and a state-machine.
const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local refillRatePerMs = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local nowMs = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil then
  tokens = limit
  ts = nowMs
else
  local elapsed = math.max(0, nowMs - ts)
  tokens = math.min(limit, tokens + elapsed * refillRatePerMs)
  ts = nowMs
end

local allowed = 0
local retryAfterMs = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  -- Time until enough tokens accumulate to satisfy this request.
  local deficit = cost - tokens
  retryAfterMs = math.ceil(deficit / refillRatePerMs)
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', ts)
redis.call('EXPIRE', key, ttl)

return { allowed, math.floor(tokens), retryAfterMs }
`;

// Read-only peek. Same refill maths, but writes nothing back — the
// bucket state at peek time stays identical to the state the next real
// check() would see. Used by ops/status queries that must not deduct
// tokens or shift the refill timestamp.
//
// KEYS[1] — bucket key
// ARGV[1] — limit
// ARGV[2] — refillRatePerMs
// ARGV[3] — nowMs
//
// Returns: { remainingTokens (int floor), retryAfterMs (int — until 1 token available) }
const TOKEN_BUCKET_PEEK_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local refillRatePerMs = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil then
  tokens = limit
else
  local elapsed = math.max(0, nowMs - ts)
  tokens = math.min(limit, tokens + elapsed * refillRatePerMs)
end

local retryAfterMs = 0
if tokens < 1 then
  retryAfterMs = math.ceil((1 - tokens) / refillRatePerMs)
end

return { math.floor(tokens), retryAfterMs }
`;

export type RateLimitDecision = {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
  readonly windowSeconds: number;
  readonly resetAt: Temporal.Instant;
};

export type RateLimitConfig = {
  readonly limit: number;
  readonly windowSeconds: number;
  readonly cost?: number;
};

export type RateLimitResolver = {
  // Atomic check + deduct. Returns the decision and current bucket state
  // — caller decides whether to throw RateLimitError or proceed.
  check(bucket: string, config: RateLimitConfig): Promise<RateLimitDecision>;

  // Convenience: throws RateLimitError when blocked. Useful inside the
  // dispatcher / middleware code-paths where the failure shape is fixed.
  enforce(bucket: string, config: RateLimitConfig): Promise<RateLimitDecision>;

  // Read-only inspection: returns the same shape as check() but never
  // mutates the bucket — no token deduction, no refill-timestamp update.
  // Use for ops/status queries (e.g. "kumiko rl status user:42") that
  // must observe the bucket without disturbing it.
  peek(bucket: string, config: Omit<RateLimitConfig, "cost">): Promise<RateLimitDecision>;
};

export type RateLimitResolverOptions = {
  readonly redis: Redis;
  // Override the prefix for tests. Production uses RedisKeys.rateLimit.
  readonly keyPrefix?: string;
  // Override the time source for tests. Production uses Date.now().
  readonly nowMs?: () => number;
};

type LuaResult = readonly [number, number, number];

// We register the script once per Redis client via defineCommand so each
// check is a single round-trip with the script already cached on the
// server (ioredis falls back to LOADing the script if the SHA is
// missing). Using defineCommand also keeps the call-site idiomatic
// (`redis.kumikoRateLimit(...)`) instead of building raw protocol calls.
type CommandClient = Redis & {
  kumikoRateLimit(
    key: string,
    limit: string,
    refillRatePerMs: string,
    cost: string,
    nowMs: string,
    ttlSeconds: string,
  ): Promise<LuaResult>;
  kumikoRateLimitPeek(
    key: string,
    limit: string,
    refillRatePerMs: string,
    nowMs: string,
  ): Promise<readonly [number, number]>;
};

const REGISTERED = new WeakSet<Redis>();

function ensureCommand(redis: Redis): CommandClient {
  if (!REGISTERED.has(redis)) {
    redis.defineCommand("kumikoRateLimit", {
      numberOfKeys: 1,
      lua: TOKEN_BUCKET_LUA,
    });
    redis.defineCommand("kumikoRateLimitPeek", {
      numberOfKeys: 1,
      lua: TOKEN_BUCKET_PEEK_LUA,
    });
    REGISTERED.add(redis);
  }
  return redis as CommandClient;
}

export function createRateLimitResolver(opts: RateLimitResolverOptions): RateLimitResolver {
  const client = ensureCommand(opts.redis);
  const prefix = opts.keyPrefix ?? RedisKeys.rateLimit;
  const now = opts.nowMs ?? (() => Date.now());

  async function check(bucket: string, config: RateLimitConfig): Promise<RateLimitDecision> {
    const cost = config.cost ?? 1;
    const refillRatePerMs = config.limit / (config.windowSeconds * 1000);
    const ttlSeconds = Math.max(1, config.windowSeconds * 2);
    const nowMs = now();

    const [allowedFlag, remaining, retryAfterMs] = await client.kumikoRateLimit(
      `${prefix}${bucket}`,
      String(config.limit),
      String(refillRatePerMs),
      String(cost),
      String(nowMs),
      String(ttlSeconds),
    );

    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    const resetAt = Temporal.Instant.fromEpochMilliseconds(nowMs + retryAfterMs);

    return {
      allowed: allowedFlag === 1,
      limit: config.limit,
      remaining,
      retryAfterSeconds,
      windowSeconds: config.windowSeconds,
      resetAt,
    };
  }

  async function enforce(bucket: string, config: RateLimitConfig): Promise<RateLimitDecision> {
    const decision = await check(bucket, config);
    if (decision.allowed) return decision;
    throw new RateLimitError({
      bucket,
      limit: decision.limit,
      windowSeconds: decision.windowSeconds,
      remaining: decision.remaining,
      retryAfterSeconds: decision.retryAfterSeconds,
      resetAt: decision.resetAt.toString(),
    });
  }

  async function peek(
    bucket: string,
    config: Omit<RateLimitConfig, "cost">,
  ): Promise<RateLimitDecision> {
    const refillRatePerMs = config.limit / (config.windowSeconds * 1000);
    const nowMs = now();

    const [remaining, retryAfterMs] = await client.kumikoRateLimitPeek(
      `${prefix}${bucket}`,
      String(config.limit),
      String(refillRatePerMs),
      String(nowMs),
    );

    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    const resetAt = Temporal.Instant.fromEpochMilliseconds(nowMs + retryAfterMs);

    return {
      // peek doesn't deduct, so a "would-be" allowed flag is meaningful:
      // true iff at least one token is available right now.
      allowed: remaining >= 1,
      limit: config.limit,
      remaining,
      retryAfterSeconds,
      windowSeconds: config.windowSeconds,
      resetAt,
    };
  }

  return { check, enforce, peek };
}
