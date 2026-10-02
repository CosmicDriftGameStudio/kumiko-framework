import { Redis } from "ioredis";

// BullMQ keys written through createJobRunner({ redisUrl }) carry no keyPrefix,
// but testRedis.redis auto-prefixes DEL arguments (not KEYS patterns), so
// deleting through it silently matches nothing. A prefix-less client sees the
// real key names.
export async function purgeRawRedisKeys(redisUrl: string, pattern: string): Promise<void> {
  const raw = new Redis(redisUrl);
  raw.on("error", () => {});
  try {
    const keys: string[] = [];
    for await (const batch of raw.scanStream({ match: pattern, count: 500 })) keys.push(...batch);
    if (keys.length > 0) await raw.del(...keys);
  } finally {
    raw.disconnect();
  }
}
