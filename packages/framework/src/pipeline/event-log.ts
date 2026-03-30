import type Redis from "ioredis";

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

export function createEventLog(redis: Redis, streamKey = "kumiko:events:log"): EventLog {
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
          obj[fields[i]!] = fields[i + 1]!;
        }
        return obj as unknown as EventLogEntry;
      });
    },
  };
}
