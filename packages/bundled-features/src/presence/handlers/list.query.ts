import { type AccessRule, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import type { PresenceEntry, PresenceListResult } from "@cosmicdrift/kumiko-types/presence-types";
import { ListSchema } from "../payloads.ts";
import {
  canUseRoom,
  othersOf,
  type PresenceRuntime,
  roomKey,
  storeFor,
  toEntries,
} from "../room.ts";

export function createListQuery(runtime: PresenceRuntime, access: AccessRule) {
  return defineQueryHandler({
    name: "list",
    schema: ListSchema,
    access,
    agent: { expose: false },
    description:
      "Lists the other people currently on each of up to 100 rows of one entity, for badges in a list; rows the caller cannot see are left out without a hint.",
    handler: async (event, ctx): Promise<PresenceListResult> => {
      const { entity, ids } = event.payload;
      if (!runtime.settings.entities.has(entity)) return { byId: {} };
      const store = storeFor(runtime, ctx);
      const nowMs = ctx.tz.now().epochMilliseconds;
      const byId: Record<string, readonly PresenceEntry[]> = {};
      for (const id of new Set(ids)) {
        const others = othersOf(
          await store.list(roomKey(ctx, entity, id), nowMs, runtime.settings.ttlMs),
          event.user.id,
        );
        // Visibility is checked only where someone is present, so an empty row costs no lookup.
        if (others.length === 0 || !(await canUseRoom(runtime, ctx, entity, id))) continue;
        byId[id] = await toEntries(ctx, others);
      }
      return { byId };
    },
  });
}
