import { type AccessRule, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import type { PresenceEntry, PresenceListResult } from "@cosmicdrift/kumiko-types/presence-types";
import { visibleParentRowIds } from "../../shared/index.ts";
import { ListSchema } from "../payloads.ts";
import {
  displayNamesOf,
  entriesWithNames,
  othersOf,
  type PresenceRuntime,
  roomKey,
  storeFor,
} from "../room.ts";
import type { PresenceRecord } from "../store.ts";

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
      const uniqueIds = [...new Set(ids)];
      const rooms = await store.listMany(
        uniqueIds.map((id) => roomKey(ctx, entity, id)),
        nowMs,
        runtime.settings.ttlMs,
      );
      const othersById = new Map<string, readonly PresenceRecord[]>();
      uniqueIds.forEach((id, index) => {
        const others = othersOf(rooms[index] ?? [], event.user.id);
        if (others.length > 0) othersById.set(id, others);
      });
      // Visibility is checked only where someone is present, so an empty row costs no lookup.
      const visibleIds = await visibleParentRowIds(
        ctx.registry,
        entity,
        [...othersById.keys()],
        event.user,
        ctx.db,
      );
      const visibleOthers = [...othersById].filter(([id]) => visibleIds.has(id));
      const names = await displayNamesOf(ctx, [
        ...new Set(visibleOthers.flatMap(([, others]) => others.map((other) => other.userId))),
      ]);
      const byId: Record<string, readonly PresenceEntry[]> = {};
      for (const [id, others] of visibleOthers) byId[id] = entriesWithNames(others, names);
      return { byId };
    },
  });
}
