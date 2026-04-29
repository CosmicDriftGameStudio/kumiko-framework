import type Redis from "ioredis";
import type { Tracer } from "./types";

// List of Redis commands we want to trace. Everything else (connection
// methods like `on`, `off`, `disconnect`, `duplicate`, plus pipeline/multi)
// falls through unwrapped. Keeping the list explicit avoids accidentally
// wrapping things that aren't commands — `connect` is a Promise, `on` is
// a listener registration — and keeps hot paths cheap.
const TRACKED_COMMANDS = new Set<string>([
  // Strings / keys
  "get",
  "set",
  "del",
  "exists",
  "expire",
  "ttl",
  "incr",
  "decr",
  "keys",
  "scan",
  "mget",
  "mset",
  // Hashes
  "hget",
  "hset",
  "hmget",
  "hmset",
  "hgetall",
  "hdel",
  "hexists",
  // Lists
  "lpush",
  "rpush",
  "lpop",
  "rpop",
  "llen",
  "lrange",
  // Sets
  "sadd",
  "srem",
  "smembers",
  "sismember",
  // Sorted sets
  "zadd",
  "zrange",
  "zrem",
  "zrangebyscore",
  // Streams
  "xadd",
  "xread",
  "xreadgroup",
  "xack",
  "xlen",
  "xgroup",
  "xdel",
  "xrange",
  "xpending",
  // Pub/Sub
  "publish",
  "subscribe",
  "unsubscribe",
  "psubscribe",
  "punsubscribe",
  // Scripting
  "eval",
  "evalsha",
]);

// Extract a redaction-safe key pattern from the first command argument.
// Actual keys often include user-generated fragments (ids, session tokens)
// that shouldn't leak into traces — we replace everything after the second
// `:` segment with `*`. Known namespace conventions (colon-separated) keep
// enough signal for grouping without leaking values.
function extractKeyPattern(arg: unknown): string | undefined {
  if (typeof arg !== "string") return undefined;
  const parts = arg.split(":");
  if (parts.length <= 2) return arg;
  return `${parts.slice(0, 2).join(":")}:*`;
}

// Wrap an ioredis client in an observability-aware proxy. Traced commands
// emit `redis.cmd` spans; everything else is passed through so pipeline,
// transaction, and connection APIs keep working.
export function wrapRedisClient(client: Redis, tracer: Tracer): Redis {
  return new Proxy(client, {
    get(target, prop, _receiver) {
      // Symbols (e.g. internal queue) pass through unchanged.
      if (typeof prop !== "string") {
        return Reflect.get(target, prop, target);
      }

      const original = Reflect.get(target, prop, target);

      if (prop === "duplicate") {
        // Preserve wrapping on duplicated connections.
        return (...args: unknown[]) => {
          // @cast-boundary engine-bridge — Reflect.get returns unknown, narrow to ioredis-method
          const dup = (original as (...args: unknown[]) => Redis).apply(target, args);
          return wrapRedisClient(dup, tracer);
        };
      }

      if (typeof original !== "function" || !TRACKED_COMMANDS.has(prop)) {
        // Pass-through for non-command methods. Bind to target so `this`
        // inside ioredis internals still works.
        if (typeof original === "function") {
          // @cast-boundary engine-bridge — Reflect.get returns unknown, narrow to ioredis-method
          return (original as (...args: unknown[]) => unknown).bind(target);
        }
        return original;
      }

      return function wrappedCommand(this: unknown, ...args: unknown[]) {
        const keyPattern = extractKeyPattern(args[0]);
        return tracer.withSpan(
          "redis.cmd",
          {
            kind: "client",
            attributes: {
              "redis.command": prop,
              ...(keyPattern ? { "redis.key_pattern": keyPattern } : {}),
            },
          },
          async () => {
            // @cast-boundary engine-bridge — Reflect.get returns unknown, narrow to ioredis-method
            return (original as (...args: unknown[]) => unknown).apply(target, args);
          },
        );
      };
    },
  });
}
