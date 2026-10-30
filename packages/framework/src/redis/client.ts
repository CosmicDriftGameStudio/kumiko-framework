// Thin factory for ioredis clients with Prod-sensible defaults.
// ioredis itself doesn't enforce a command-timeout — an unreachable Redis
// will silently hang a request forever unless the caller sets
// `commandTimeout`. Same story for connectTimeout: the default is 10s,
// which is too long for a /health/ready probe with a 2s budget.
//
// Apps are expected to build their Redis clients via this helper so
// production defaults stay consistent and env-var wiring lives in one
// place. Tests / one-off scripts can still `new Redis()` directly.
//
// Split out of index.ts so pubsub-signal.ts can import this without a
// same-directory cycle back through the barrel.

import { Redis, type RedisOptions } from "ioredis";
import { scrubLogText } from "../logging/scrub.ts";
import type { Logger } from "../logging/types.ts";
import { readPositiveIntEnv } from "../utils/env-parse.ts";

// Connection-tuning options. The fields mirror the most consequential
// ioredis settings; anything else can be passed through via `extra` to
// keep the helper from re-declaring the full ioredis surface.
export type RedisClientOptions = {
  // Milliseconds to wait when opening the TCP connection. Default 5s —
  // long enough for a cold cache/standby to handshake, short enough that
  // /health/ready can surface "Redis is gone" inside its 2s-ish probe
  // window (probe runs in parallel, so 5s here + 2s timeout on the probe
  // side gives the probe a real answer instead of a hang).
  readonly connectTimeoutMs?: number;
  // Milliseconds to wait for a single command to round-trip. Default 10s.
  // Without this, ioredis waits forever on a stalled connection — a
  // single bad network partition quietly exhausts the whole command queue.
  readonly commandTimeoutMs?: number;
  // Retries per request before bubbling up as an error. Default 3 — enough
  // to ride out a transient blip but not so many that a dead Redis keeps
  // requests stuck waiting for retries.
  readonly maxRetriesPerRequest?: number;
  // Escape hatch for any ioredis option the helper doesn't expose
  // explicitly (TLS config, Sentinel, ReadyCheck toggles, …).
  readonly extra?: Readonly<
    Omit<RedisOptions, "connectTimeout" | "commandTimeout" | "maxRetriesPerRequest">
  >;
};

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES_PER_REQUEST = 3;

export function createRedisClient(url: string, options: RedisClientOptions = {}): Redis {
  const connectTimeout = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const commandTimeout = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const maxRetriesPerRequest = options.maxRetriesPerRequest ?? DEFAULT_MAX_RETRIES_PER_REQUEST;

  return new Redis(url, {
    ...options.extra,
    connectTimeout,
    commandTimeout,
    maxRetriesPerRequest,
  });
}

// ioredis reconnects on its own and re-emits "error" for every failed attempt; only the
// transitions are worth a log line. A Redis outage degrades the app, it must not crash it.
export function logRedisConnectionState(redis: Redis, logger: Pick<Logger, "warn" | "info">): void {
  let connectionLost = false;
  redis.on("error", (err: Error) => {
    // skip: only the transition is logged, ioredis repeats the error on every retry
    if (connectionLost) return;
    connectionLost = true;
    logger.warn("redis connection lost, reconnecting", { error: scrubLogText(err.message) });
  });
  redis.on("ready", () => {
    // skip: the initial connect is not a recovery
    if (!connectionLost) return;
    connectionLost = false;
    logger.info("redis recovered");
  });
}

const BULLMQ_DEFAULT_PREFIX = "bull";
// No ":" and no glob characters: the ACL rules `~<P>:*` / `&<P>:*` must not match a sibling app ("app-x" vs "app-x2:").
const REDIS_PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;

export type RedisNamespace = {
  /** ioredis keyPrefix for every non-BullMQ key; "" when unnamespaced. */
  readonly keyPrefix: string;
  /** BullMQ `prefix` option ("bull" is BullMQ's own default). BullMQ rejects an ioredis keyPrefix. */
  readonly bullmqPrefix: string;
  /** Prepended to every Pub/Sub channel (ioredis keyPrefix does not apply to Pub/Sub). */
  readonly channelPrefix: string;
  /** Set only with KUMIKO_REDIS_PREFIX. Redis checks PSUBSCRIBE patterns against `&` ACL rules literally,
   *  so `P:kumiko:sse:*` is NOPERM under `&P:*`; subscribe to `P:*` and filter by channel instead. */
  readonly channelSubscribePattern: string | undefined;
};

// KUMIKO_REDIS_PREFIX namespaces keys and channels for apps sharing one Redis behind per-app ACL users.
// KUMIKO_REDIS_CHANNEL_PREFIX alone keeps its older channels-only behaviour.
export function redisNamespaceFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RedisNamespace {
  const prefix = env["KUMIKO_REDIS_PREFIX"]?.trim();
  const channelPrefix = env["KUMIKO_REDIS_CHANNEL_PREFIX"]?.trim();
  if (!prefix) {
    return {
      keyPrefix: "",
      bullmqPrefix: BULLMQ_DEFAULT_PREFIX,
      channelPrefix: channelPrefix ? `${channelPrefix}:` : "",
      channelSubscribePattern: undefined,
    };
  }
  if (!REDIS_PREFIX_PATTERN.test(prefix)) {
    throw new Error(
      `KUMIKO_REDIS_PREFIX "${prefix}" is invalid: use 1-63 characters of A-Z a-z 0-9 _ - starting with a letter or digit (no ":" or glob characters).`,
    );
  }
  if (channelPrefix && channelPrefix !== prefix) {
    throw new Error(
      `KUMIKO_REDIS_PREFIX "${prefix}" and KUMIKO_REDIS_CHANNEL_PREFIX "${channelPrefix}" differ; unset the channel prefix or make them equal.`,
    );
  }
  return {
    keyPrefix: `${prefix}:`,
    bullmqPrefix: `${prefix}:${BULLMQ_DEFAULT_PREFIX}`,
    channelPrefix: `${prefix}:`,
    channelSubscribePattern: `${prefix}:*`,
  };
}

export function redisChannelPrefixFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return redisNamespaceFromEnv(env).channelPrefix;
}

// Env-var reader — mirrors dbConnectionOptionsFromEnv's contract. Strict:
// malformed values throw at boot rather than silently falling back to
// defaults.
export function redisClientOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RedisClientOptions {
  const opts: RedisClientOptions & {
    connectTimeoutMs?: number;
    commandTimeoutMs?: number;
    maxRetriesPerRequest?: number;
  } = {};
  const connect = readPositiveIntEnv(env, "REDIS_CONNECT_TIMEOUT_MS");
  const command = readPositiveIntEnv(env, "REDIS_COMMAND_TIMEOUT_MS");
  const retries = readPositiveIntEnv(env, "REDIS_MAX_RETRIES_PER_REQUEST");
  if (connect !== undefined) opts.connectTimeoutMs = connect;
  if (command !== undefined) opts.commandTimeoutMs = command;
  if (retries !== undefined) opts.maxRetriesPerRequest = retries;
  return opts;
}
