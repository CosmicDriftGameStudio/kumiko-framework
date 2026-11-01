import type { Logger } from "@cosmicdrift/kumiko-framework/logging";
import type { PresenceActivity } from "@cosmicdrift/kumiko-types/presence-types";
import type { Redis } from "ioredis";
import * as z from "zod";

export type PresenceRecord = {
  readonly userId: string;
  readonly activity: PresenceActivity;
  readonly focus?: string;
  readonly since: number;
  readonly seenAt: number;
};

export type PresenceState = {
  readonly activity: PresenceActivity;
  readonly focus?: string;
};

// Presence is ephemeral and best-effort: implementations must never throw, a store that
// cannot answer behaves like an empty room.
export type PresenceStore = {
  /** `changed` is true for a new entry or a changed activity/focus, false for a plain keep-alive. */
  touch(
    key: string,
    userId: string,
    state: PresenceState,
    nowMs: number,
    ttlMs: number,
  ): Promise<{ readonly changed: boolean }>;
  remove(key: string, userId: string): Promise<{ readonly existed: boolean }>;
  /** Live entries only; expired ones are dropped on read. */
  list(key: string, nowMs: number, ttlMs: number): Promise<readonly PresenceRecord[]>;
};

export function presenceKey(tenantId: string, entity: string, id: string): string {
  return `presence:${tenantId}:${entity}:${id}`;
}

function isExpired(record: PresenceRecord, nowMs: number, ttlMs: number): boolean {
  return record.seenAt + ttlMs < nowMs;
}

function sameState(record: PresenceRecord, state: PresenceState): boolean {
  return record.activity === state.activity && record.focus === state.focus;
}

function nextRecord(
  userId: string,
  state: PresenceState,
  previous: PresenceRecord | undefined,
  nowMs: number,
): PresenceRecord {
  const unchanged = previous !== undefined && sameState(previous, state);
  return {
    userId,
    activity: state.activity,
    ...(state.focus !== undefined && { focus: state.focus }),
    since: unchanged ? previous.since : nowMs,
    seenAt: nowMs,
  };
}

export type MemoryPresenceStore = PresenceStore & {
  /** Rooms currently held, expired or not; lets tests observe the sweep. */
  roomCount(): number;
};

export function createMemoryPresenceStore(): MemoryPresenceStore {
  const rooms = new Map<string, Map<string, PresenceRecord>>();
  let lastSweepMs = 0;

  // Rooms whose last user left without a leave are never read again, so reads alone would keep
  // them forever; a sweep per ttl on write bounds the map.
  function sweepExpired(nowMs: number, ttlMs: number): void {
    // skip: the last sweep is still within one ttl
    if (nowMs - lastSweepMs < ttlMs) return;
    lastSweepMs = nowMs;
    for (const [key, room] of rooms) {
      for (const [userId, record] of room) {
        if (isExpired(record, nowMs, ttlMs)) room.delete(userId);
      }
      if (room.size === 0) rooms.delete(key);
    }
  }

  return {
    roomCount: () => rooms.size,
    async touch(key, userId, state, nowMs, ttlMs) {
      sweepExpired(nowMs, ttlMs);
      const room = rooms.get(key) ?? new Map<string, PresenceRecord>();
      rooms.set(key, room);
      const existing = room.get(userId);
      const previous = existing && !isExpired(existing, nowMs, ttlMs) ? existing : undefined;
      room.set(userId, nextRecord(userId, state, previous, nowMs));
      return { changed: previous === undefined || !sameState(previous, state) };
    },
    async remove(key, userId) {
      const room = rooms.get(key);
      const existed = room?.delete(userId) ?? false;
      if (room?.size === 0) rooms.delete(key);
      return { existed };
    },
    async list(key, nowMs, ttlMs) {
      const room = rooms.get(key);
      if (!room) return [];
      for (const [userId, record] of room) {
        if (isExpired(record, nowMs, ttlMs)) room.delete(userId);
      }
      if (room.size === 0) rooms.delete(key);
      return [...room.values()];
    },
  };
}

const KEY_TTL_FACTOR = 2;

const storedRecordSchema = z.object({
  activity: z.enum(["viewing", "editing"]),
  focus: z.string().optional(),
  since: z.number(),
  seenAt: z.number(),
});

// Stored value carries no display name: Redis and the live frames hold ids only.
function parseRecord(userId: string, raw: string): PresenceRecord | undefined {
  try {
    const parsed = storedRecordSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return undefined;
    const { activity, focus, since, seenAt } = parsed.data;
    return { userId, activity, ...(focus !== undefined && { focus }), since, seenAt };
  } catch {
    return undefined;
  }
}

export function createRedisPresenceStore(redis: Redis, log: Logger): PresenceStore {
  async function guarded<T>(fallback: T, run: () => Promise<T>): Promise<T> {
    if (redis.status !== "ready") {
      log.warn("presence store skipped: redis connection not ready", { status: redis.status });
      return fallback;
    }
    try {
      return await run();
    } catch (err) {
      log.warn("presence store command failed", { err });
      return fallback;
    }
  }

  async function read(key: string, userId: string): Promise<PresenceRecord | undefined> {
    const raw = await redis.hget(key, userId);
    return raw === null ? undefined : parseRecord(userId, raw);
  }

  return {
    touch: (key, userId, state, nowMs, ttlMs) =>
      guarded({ changed: false }, async () => {
        const existing = await read(key, userId);
        const previous = existing && !isExpired(existing, nowMs, ttlMs) ? existing : undefined;
        const record = nextRecord(userId, state, previous, nowMs);
        const { userId: _omit, ...stored } = record;
        await redis
          .multi()
          .hset(key, userId, JSON.stringify(stored))
          .expire(key, Math.ceil((ttlMs * KEY_TTL_FACTOR) / 1000))
          .exec();
        return { changed: previous === undefined || !sameState(previous, state) };
      }),
    remove: (key, userId) =>
      guarded({ existed: false }, async () => ({ existed: (await redis.hdel(key, userId)) > 0 })),
    list: (key, nowMs, ttlMs) =>
      guarded<readonly PresenceRecord[]>([], async () => {
        const all = await redis.hgetall(key);
        const live: PresenceRecord[] = [];
        const expired: string[] = [];
        for (const [userId, raw] of Object.entries(all)) {
          const record = parseRecord(userId, raw);
          if (record && !isExpired(record, nowMs, ttlMs)) live.push(record);
          else expired.push(userId);
        }
        if (expired.length > 0) await redis.hdel(key, ...expired);
        return live;
      }),
  };
}
