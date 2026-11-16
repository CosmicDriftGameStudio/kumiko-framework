import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { Redis } from "ioredis";

export type RateLimitConfig = {
  readonly redis: Redis;
  readonly maxPerHour: number; // per channel per tenant
  readonly keyPrefix?: string;
};

// Rate limit check: atomic INCR + TTL + over-limit rollback via server-side
// Lua. Runs single-threaded in Redis, so two parallel clients can't both
// observe `count <= max` and slip past. The prior non-atomic JS version
// could leave the counter stuck below the true hit count when two INCRs
// raced into simultaneous DECR rollbacks.
const RATE_LIMIT_LUA = `
    local count = redis.call('INCR', KEYS[1])
    if count == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[1])
    end
    if count > tonumber(ARGV[2]) then
      redis.call('DECR', KEYS[1])
      return 0
    end
    return 1
  `;

type RedisWithLua = Redis & {
  deliveryRateLimitCheck: (key: string, ttl: string, max: string) => Promise<number>;
};

// Register the Lua script once per Redis client. Noop if already defined.
export function registerDeliveryRateLimitScript(redis: Redis): void {
  // @cast-boundary engine-bridge — defineCommand attaches the Lua method post-boot
  const r = redis as Partial<Pick<RedisWithLua, "deliveryRateLimitCheck">> & Redis;
  if (!r.deliveryRateLimitCheck) {
    r.defineCommand("deliveryRateLimitCheck", { numberOfKeys: 1, lua: RATE_LIMIT_LUA });
  }
}

export async function checkDeliveryRateLimit(
  rateLimit: RateLimitConfig,
  tenantId: TenantId,
  channelName: string,
): Promise<boolean> {
  const key = `${rateLimit.keyPrefix ?? "delivery:rate"}:${tenantId}:${channelName}`;
  // @cast-boundary engine-bridge — defineCommand attaches the Lua method shape at boot
  const r = rateLimit.redis as RedisWithLua;
  const allowed = await r.deliveryRateLimitCheck(key, "3600", String(rateLimit.maxPerHour));
  return Number(allowed) === 1;
}
