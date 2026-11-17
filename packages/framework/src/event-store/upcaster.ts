import type { EventUpcastCtx, EventUpcastFn } from "@cosmicdrift/kumiko-types/handlers";
import type { DbRunner } from "../db/index.ts";
import type { TenantId } from "../engine/types/index.ts";
import { EventVersionAheadError } from "./errors.ts";
import type { StoredEvent } from "./event-store.ts";
import { recordUpcasterDeadLetter } from "./upcaster-dead-letter.ts";

// Error-handling contract for the upcast pass.
//
//   throw      — the pass aborts, the dispatcher retries, a permanently broken
//                payload eventually dead-letters at the consumer level after
//                maxAttempts retries. Pick this when every event must land
//                exactly once and "skip" is never acceptable.
//
//   quarantine — the failing event is written to `kumiko_upcaster_dead_letters`
//                with the error + original payload and REMOVED from the
//                returned list. The dispatcher skips it cleanly; ops tooling
//                replays after the code fix. Pick this for projections where a
//                single unrenderable historic event shouldn't block the rest
//                of the stream.
export type UpcasterErrorPolicy = "throw" | "quarantine";

export type UpcastOptions = {
  readonly errorPolicy?: UpcasterErrorPolicy;
};

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
//   - A failing transform propagates its error (errorPolicy "throw"); with
//     "quarantine" it is recorded as an upcaster dead letter and the event is dropped.
//
// `ctx` carries db + tenantId for async upcasters that need DB enrichment.
// Sync transforms ignore ctx entirely.
export async function upcastStoredEvent(
  event: StoredEvent,
  upcasters: EventUpcasters,
  ctx: EventUpcastCtx,
): Promise<StoredEvent> {
  const result = await upcastStoredEventWithPolicy(event, upcasters, ctx, {
    errorPolicy: "throw",
  });
  // `throw` mode never returns null: the catch-block rethrows.
  if (result === null) {
    throw new Error(
      `unreachable: upcastStoredEvent with errorPolicy="throw" returned null for "${event.type}"`,
    );
  }
  return result;
}

// Returns null when the transform threw AND errorPolicy="quarantine".
async function upcastStoredEventWithPolicy(
  event: StoredEvent,
  upcasters: EventUpcasters,
  ctx: EventUpcastCtx,
  options: UpcastOptions,
): Promise<StoredEvent | null> {
  const info = upcasters.get(event.type);
  const knownVersion = info?.currentVersion ?? 1;
  if (event.eventVersion > knownVersion) {
    throw new EventVersionAheadError(event.type, event.id, event.eventVersion, knownVersion);
  }
  if (!info || event.eventVersion === knownVersion) return event;

  let payload = event.payload as unknown; // @cast-boundary engine-payload
  let v = event.eventVersion;
  const startVersion = event.eventVersion;
  while (v < info.currentVersion) {
    const transform = info.chain.get(v);
    if (!transform) {
      // Missing chain is a boot-validator bug, not a data problem: always throw
      // regardless of policy so the gap gets fixed instead of rotting into dead letters.
      throw new Error(
        `Missing upcaster for event "${event.type}" v${v} → v${v + 1}. ` +
          `The registry should have caught this at boot — check the eventUpcasterMap wiring.`,
      );
    }
    try {
      payload = await transform(payload, ctx);
      v++;
    } catch (err) {
      if (options.errorPolicy === "quarantine") {
        await recordUpcasterDeadLetter(ctx.db, {
          event,
          fromVersion: startVersion,
          targetVersion: info.currentVersion,
          error: err,
        });
        return null;
      }
      throw err;
    }
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
  options: UpcastOptions = {},
): Promise<readonly StoredEvent[]> {
  const results = await Promise.all(
    events.map((e) => upcastStoredEventWithPolicy(e, upcasters, ctx, options)),
  );
  return results.filter((e): e is StoredEvent => e !== null);
}

// Convenience builder for callers that have db + tenantId at hand and want
// to construct the ctx-arg without restating the field names everywhere.
export function makeUpcastCtx(db: DbRunner, tenantId: TenantId): EventUpcastCtx {
  return { db, tenantId };
}
