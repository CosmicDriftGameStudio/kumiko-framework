import type { EventUpcastCtx, EventUpcastFn } from "@cosmicdrift/kumiko-types/handlers";
import type { DbRunner } from "../db/index.ts";
import type { TenantId } from "../engine/types/index.ts";

import type { StoredEvent } from "./event-store.ts";
import { EventVersionAheadError } from "./errors.ts";

// Event schema evolution (Marten-style upcaster). An event's stored payload
// stays immutable on disk; when a feature bumps the event version and
// registers step-wise r.eventMigration transforms, reads walk older events
// through the chain until the payload matches the current shape.
//
// Sync transforms cost O(version_gap) plain JSON rewrites — hot path on
// projection rebuild stays cheap. Async transforms (Marten's
// AsyncOnlyEventUpcaster) for DB-enrichment are supported via the same
// signature: return Promise<unknown>, the framework awaits unconditionally.
// Sync transforms still pay only the await-microtask overhead.

export type EventUpcasters = ReadonlyMap<
  string,
  { readonly currentVersion: number; readonly chain: ReadonlyMap<number, EventUpcastFn> }
>;

// Upcast a single stored event through however many registered migrations
// separate its stored eventVersion from the current schema version.
//
// Contract:
//   - Event types with no registered upcaster pass through unchanged at eventVersion 1.
//   - Event types whose stored version equals currentVersion pass through
//     unchanged (fast path — hot on projection rebuild).
//   - A stored eventVersion above the known one (or above 1 for an unregistered type)
//     throws EventVersionAheadError.
//   - Gaps in the chain are a hard error. The registry validates chain
//     completeness at boot, so this throw is a belt-and-suspenders signal
//     that something wrote a version number the registry doesn't expect.
//   - A failing transform propagates its error.
//
// `ctx` carries db + tenantId for async upcasters that need DB enrichment.
// Sync transforms ignore ctx entirely.
export async function upcastStoredEvent(
  event: StoredEvent,
  upcasters: EventUpcasters,
  ctx: EventUpcastCtx,
): Promise<StoredEvent> {
  const info = upcasters.get(event.type);
  const knownVersion = info?.currentVersion ?? 1;
  if (event.eventVersion > knownVersion) {
    throw new EventVersionAheadError(event.type, event.id, event.eventVersion, knownVersion);
  }
  if (!info || event.eventVersion === knownVersion) return event;

  let payload = event.payload as unknown; // @cast-boundary engine-payload
  let v = event.eventVersion;
  while (v < info.currentVersion) {
    const transform = info.chain.get(v);
    if (!transform) {
      // Missing chain is a boot-validator bug, not a data problem.
      throw new Error(
        `Missing upcaster for event "${event.type}" v${v} → v${v + 1}. ` +
          `The registry should have caught this at boot — check the eventUpcasterMap wiring.`,
      );
    }
    payload = await transform(payload, ctx);
    v++;
  }
  return {
    ...event,
    payload: payload as Record<string, unknown>, // @cast-boundary engine-payload
    eventVersion: v,
  };
}

export async function upcastStoredEvents(
  events: readonly StoredEvent[],
  upcasters: EventUpcasters,
  ctx: EventUpcastCtx,
): Promise<readonly StoredEvent[]> {
  return Promise.all(events.map((e) => upcastStoredEvent(e, upcasters, ctx)));
}

// Convenience builder for callers that have db + tenantId at hand and want
// to construct the ctx-arg without restating the field names everywhere.
export function makeUpcastCtx(db: DbRunner, tenantId: TenantId): EventUpcastCtx {
  return { db, tenantId };
}
