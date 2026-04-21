// Thin factory for ioredis clients with Prod-sensible defaults.
// ioredis itself doesn't enforce a command-timeout — an unreachable Redis
// will silently hang a request forever unless the caller sets
// `commandTimeout`. Same story for connectTimeout: the default is 10s,
// which is too long for a /health/ready probe with a 2s budget.
//
// Apps are expected to build their Redis clients via this helper so
// production defaults stay consistent and env-var wiring lives in one
// place. Tests / one-off scripts can still `new Redis()` directly.

import IoRedis, { type Redis, type RedisOptions } from "ioredis";

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

  return new IoRedis(url, {
    ...options.extra,
    connectTimeout,
    commandTimeout,
    maxRetriesPerRequest,
  });
}

// Env-var reader — mirrors dbConnectionOptionsFromEnv's contract. Strict:
// malformed values throw at boot rather than silently falling back to
// defaults.
export function redisClientOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RedisClientOptions {
  const opts: {
    connectTimeoutMs?: number;
    commandTimeoutMs?: number;
    maxRetriesPerRequest?: number;
  } = {};
  const read = (name: string): number | undefined => {
    const raw = env[name];
    if (raw === undefined || raw === "") return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      throw new Error(`[redis] ${name}="${raw}" must be a non-negative integer`);
    }
    return n;
  };
  const connect = read("REDIS_CONNECT_TIMEOUT_MS");
  const command = read("REDIS_COMMAND_TIMEOUT_MS");
  const retries = read("REDIS_MAX_RETRIES_PER_REQUEST");
  if (connect !== undefined) opts.connectTimeoutMs = connect;
  if (command !== undefined) opts.commandTimeoutMs = command;
  if (retries !== undefined) opts.maxRetriesPerRequest = retries;
  return opts;
}
