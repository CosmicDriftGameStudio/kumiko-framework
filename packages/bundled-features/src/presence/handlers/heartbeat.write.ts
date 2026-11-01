import { type AccessRule, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import {
  PRESENCE_CHANGED_EVENT,
  type PresenceHeartbeatResult,
} from "@cosmicdrift/kumiko-types/presence-types";
import { HeartbeatSchema } from "../payloads.ts";
import {
  canUseRoom,
  othersOf,
  type PresenceRuntime,
  roomKey,
  storeFor,
  toEntries,
} from "../room.ts";

export function createHeartbeatHandler(runtime: PresenceRuntime, access: AccessRule) {
  return defineWriteHandler<"heartbeat", typeof HeartbeatSchema, PresenceHeartbeatResult>({
    name: "heartbeat",
    schema: HeartbeatSchema,
    access,
    agent: { expose: false },
    // Presence lives in Redis or memory, never Postgres: no transaction per 15 s heartbeat.
    transaction: "perCommand",
    description:
      "Announces that the caller is looking at or editing one row and answers with the other people currently on it; the browser sends it every 15 seconds while a record is open.",
    handler: async (event, ctx) => {
      const { entity, id, activity, focus } = event.payload;
      if (!(await canUseRoom(runtime, ctx, entity, id))) {
        return writeFailure(new NotFoundError(entity, id));
      }
      const store = storeFor(runtime, ctx);
      const key = roomKey(ctx, entity, id);
      const nowMs = ctx.tz.now().epochMilliseconds;
      const { changed } = await store.touch(
        key,
        event.user.id,
        { activity, ...(focus !== undefined && { focus }) },
        nowMs,
        runtime.settings.ttlMs,
      );
      const others = othersOf(await store.list(key, nowMs, runtime.settings.ttlMs), event.user.id);
      if (changed && others.length > 0) {
        await ctx.services.userLiveSignals?.push(
          others.map((record) => record.userId),
          { type: PRESENCE_CHANGED_EVENT, entity, id },
        );
      }
      return { isSuccess: true, data: { others: await toEntries(ctx, others) } };
    },
  });
}
