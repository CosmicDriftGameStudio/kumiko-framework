import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import type { PresenceEntry } from "@cosmicdrift/kumiko-types/presence-types";
import { parentRowIsVisible } from "../shared/index.ts";
import { resolveUserDisplayNames, USER_FEATURE } from "../user/index.ts";
import type { PresenceSettings } from "./options.ts";
import {
  createRedisPresenceStore,
  type PresenceRecord,
  type PresenceStore,
  presenceKey,
} from "./store.ts";

export type PresenceRuntime = {
  readonly settings: PresenceSettings;
  readonly memoryStore: PresenceStore;
};

export function storeFor(runtime: PresenceRuntime, ctx: HandlerContext): PresenceStore {
  const redis = ctx.services.redis;
  return redis ? createRedisPresenceStore(redis, ctx.obs.log) : runtime.memoryStore;
}

export function roomKey(ctx: HandlerContext, entity: string, id: string): string {
  return presenceKey(ctx.user.tenantId, entity, id);
}

// Not-allowed and not-visible are indistinguishable to the caller, so the endpoint is no
// existence oracle for rows or entity names.
export async function canUseRoom(
  runtime: PresenceRuntime,
  ctx: HandlerContext,
  entity: string,
  id: string,
): Promise<boolean> {
  if (!runtime.settings.entities.has(entity)) return false;
  return parentRowIsVisible(ctx.registry, entity, id, ctx.user, ctx.db);
}

export function othersOf(
  records: readonly PresenceRecord[],
  userId: string,
): readonly PresenceRecord[] {
  return records.filter((record) => record.userId !== userId);
}

// Names are looked up per response and never stored, so an erased user leaves no name behind.
export async function toEntries(
  ctx: HandlerContext,
  records: readonly PresenceRecord[],
): Promise<readonly PresenceEntry[]> {
  if (records.length === 0) return [];
  const names = ctx.registry.getFeature(USER_FEATURE)
    ? await resolveUserDisplayNames(
        ctx.db,
        records.map((record) => record.userId),
      )
    : new Map<string, string>();
  return records.map((record) => ({
    userId: record.userId,
    displayName: names.get(record.userId) ?? record.userId,
    activity: record.activity,
    ...(record.focus !== undefined && { focus: record.focus }),
    since: Temporal.Instant.fromEpochMilliseconds(record.since).toString(),
  }));
}
