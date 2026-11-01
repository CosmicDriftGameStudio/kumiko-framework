import { type AccessRule, defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { PRESENCE_CHANGED_EVENT } from "@cosmicdrift/kumiko-types/presence-types";
import { LeaveSchema } from "../payloads.ts";
import { canUseRoom, othersOf, type PresenceRuntime, roomKey, storeFor } from "../room.ts";

export function createLeaveHandler(runtime: PresenceRuntime, access: AccessRule) {
  return defineWriteHandler<"leave", typeof LeaveSchema, { readonly left: boolean }>({
    name: "leave",
    schema: LeaveSchema,
    access,
    agent: { expose: false },
    // Presence lives in Redis or memory, never Postgres: no transaction per 15 s heartbeat.
    transaction: "perCommand",
    description:
      "Removes the caller from one row's presence list right away, so others do not wait for the entry to expire; the browser sends it when a record is closed.",
    handler: async (event, ctx) => {
      const { entity, id } = event.payload;
      if (!(await canUseRoom(runtime, ctx, entity, id))) {
        return writeFailure(new NotFoundError(entity, id));
      }
      const store = storeFor(runtime, ctx);
      const key = roomKey(ctx, entity, id);
      const { existed } = await store.remove(key, event.user.id);
      if (existed) {
        const nowMs = ctx.tz.now().epochMilliseconds;
        const others = othersOf(
          await store.list(key, nowMs, runtime.settings.ttlMs),
          event.user.id,
        );
        if (others.length > 0) {
          await ctx.services.userLiveSignals?.push(
            others.map((record) => record.userId),
            { type: PRESENCE_CHANGED_EVENT, entity, id },
          );
        }
      }
      return { isSuccess: true, data: { left: existed } };
    },
  });
}
