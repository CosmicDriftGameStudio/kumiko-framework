import type { DbRunner } from "../db";
import type { EventUpcastCtx, EventUpcastFn, TenantId } from "../engine/types";
import type { StoredEvent } from "./event-store";
import { recordUpcasterDeadLetter } from "./upcaster-dead-letter";

// Error-handling contract for the upcast pass.
//
//   throw     — legacy behaviour: the pass aborts, the dispatcher retries,
//               a permanently broken payload eventually dead-letters at
//               the consumer level after maxAttempts retries. Pick this
//               when every event must land exactly once and "skip" is
//               never acceptable.
//
//   quarantine — the failing event is written to
//               `kumiko_upcaster_dead_letters` with the error + original
//               payload and REMOVED from the returned list. The
//               dispatcher skips it cleanly; ops tooling replays after
//               the code fix. Pick this for projections where a single
//               unrenderable historic event shouldn't block the rest
//               of the stream.
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
//   - Event types with no registered upcaster pass through unchanged.
//   - Event types whose stored version equals currentVersion pass through
//     unchanged (fast path — hot on projection rebuild).
//   - Gaps in the chain are a hard error. The registry validates chain
//     completeness at boot, so this throw is a belt-and-suspenders signal
//     that something wrote a version number the registry doesn't expect.
//
// `ctx` carries db + tenantId for async upcasters that need DB enrichment.
// Sync transforms ignore ctx entirely.
// Legacy throw-on-error API — preserved so existing callers (projection-
// rebuild, msp-rebuild, feature tests) stay unchanged. Returns a
// StoredEvent (never null); quarantine mode lives on the bulk helper.
export async function upcastStoredEvent(
  event: StoredEvent,
  upcasters: EventUpcasters,
  ctx: EventUpcastCtx,
): Promise<StoredEvent> {
  const result = await upcastStoredEventWithPolicy(event, upcasters, ctx, {
    errorPolicy: "throw",
  });
  // `throw` mode can never return null — the catch-block rethrows. Narrow
  // the type for callers without an `if (result === null)` check at every
  // callsite.
  if (result === null) {
    throw new Error(
      `unreachable: upcastStoredEvent with errorPolicy="throw" returned null for "${event.type}"`,
    );
  }
  return result;
}

// Underlying policy-aware worker. Returns null when the transform threw
// AND errorPolicy="quarantine" — the event gets recorded in dead-letters
// and the bulk helper filters it out.
async function upcastStoredEventWithPolicy(
  event: StoredEvent,
  upcasters: EventUpcasters,
  ctx: EventUpcastCtx,
  options: UpcastOptions,
): Promise<StoredEvent | null> {
  const info = upcasters.get(event.type);
  if (!info) return event;
  if (event.eventVersion >= info.currentVersion) return event;

  let payload = event.payload as unknown;
  let v = event.eventVersion;
  const startVersion = event.eventVersion;
  while (v < info.currentVersion) {
    const transform = info.chain.get(v);
    if (!transform) {
      // Missing chain is a boot-validator bug, not a data problem —
      // always throw regardless of policy so the gap gets fixed rather
      // than silently rotting every affected event into dead-letters.
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
  // skip: no upcasters registered anywhere — common case when a project
  // hasn't bumped any event version yet. Short-circuit keeps replay fast.
  if (upcasters.size === 0) return events;
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
