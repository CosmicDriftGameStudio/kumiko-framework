import type Redis from "ioredis";
import { RedisKeys } from "./redis-keys";

export type EventLogEntry = {
  type: string;
  payload: string;
  userId: string;
  tenantId: string;
  timestamp: string;
};

export type EventLog = {
  append(entry: {
    type: string;
    payload: Record<string, unknown>;
    userId: number;
    tenantId: number;
  }): Promise<string>;
  recent(count?: number): Promise<EventLogEntry[]>;
};

export function createEventLog(redis: Redis, streamKey: string = RedisKeys.eventLog): EventLog {
  return {
    async append(entry) {
      const id = await redis.xadd(
        streamKey,
        "*",
        "type",
        entry.type,
        "payload",
        JSON.stringify(entry.payload),
        "userId",
        String(entry.userId),
        "tenantId",
        String(entry.tenantId),
        "timestamp",
        new Date().toISOString(),
      );
      if (!id) throw new Error("Failed to append to event log");
      return id;
    },

    async recent(count = 50) {
      const entries = await redis.xrevrange(streamKey, "+", "-", "COUNT", count);
      return entries.map(([_id, fields]) => {
        const obj: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          const key = fields[i];
          const val = fields[i + 1];
          if (key !== undefined && val !== undefined) obj[key] = val;
        }
        return obj as unknown as EventLogEntry;
      });
    },
  };
}
