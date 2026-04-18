import type { DbRunner } from "../db";
import type { EventUpcastCtx, EventUpcastFn, TenantId } from "../engine/types";
import type { StoredEvent } from "./event-store";

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
//   - Event types with no registered upcaster pass through unchanged.
//   - Event types whose stored version equals currentVersion pass through
//     unchanged (fast path — hot on projection rebuild).
//   - Gaps in the chain are a hard error. The registry validates chain
//     completeness at boot, so this throw is a belt-and-suspenders signal
//     that something wrote a version number the registry doesn't expect.
//
// `ctx` carries db + tenantId for async upcasters that need DB enrichment.
// Sync transforms ignore ctx entirely.
export async function upcastStoredEvent(
  event: StoredEvent,
  upcasters: EventUpcasters,
  ctx: EventUpcastCtx,
): Promise<StoredEvent> {
  const info = upcasters.get(event.type);
  if (!info) return event;
  if (event.eventVersion >= info.currentVersion) return event;

  let payload = event.payload as unknown;
  let v = event.eventVersion;
  while (v < info.currentVersion) {
    const transform = info.chain.get(v);
    if (!transform) {
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
    payload: payload as Record<string, unknown>,
    eventVersion: v,
  };
}

export async function upcastStoredEvents(
  events: readonly StoredEvent[],
  upcasters: EventUpcasters,
  ctx: EventUpcastCtx,
): Promise<readonly StoredEvent[]> {
  // skip: no upcasters registered anywhere — common case when a project
  // hasn't bumped any event version yet. Short-circuit keeps replay fast.
  if (upcasters.size === 0) return events;
  return Promise.all(events.map((e) => upcastStoredEvent(e, upcasters, ctx)));
}

// Convenience builder for callers that have db + tenantId at hand and want
// to construct the ctx-arg without restating the field names everywhere.
export function makeUpcastCtx(db: DbRunner, tenantId: TenantId): EventUpcastCtx {
  return { db, tenantId };
}
