// PII stance of every `kumiko:system:*` event. System events bypass the
// registry (append-event-core), so they never reach the defineEvent catalog;
// this static map is their catalog. encryptEventPayloadPii fails closed on a
// system type with no entry here, so a new system event cannot ship its
// payload as plaintext by omission.

import type { EventPiiStance } from "@cosmicdrift/kumiko-types/handlers";
export const SYSTEM_EVENT_PREFIX = "kumiko:system:";

// Lives here (not in event-store/transfer.ts) so this module stays free of
// an event-store import cycle; transfer.ts re-exports it.
export const AGGREGATE_TRANSFERRED_EVENT_TYPE = `${SYSTEM_EVENT_PREFIX}aggregate.transferred`;

// Payload is version/commit/pod name/start time — no personal data.
export const APP_STARTED_EVENT_TYPE = `${SYSTEM_EVENT_PREFIX}app.started`;
export const APP_INSTANCE_STREAM_TYPE = "app-instance";

export const SYSTEM_EVENT_PII_STANCES: ReadonlyMap<string, EventPiiStance> = new Map<
  string,
  EventPiiStance
>([
  [AGGREGATE_TRANSFERRED_EVENT_TYPE, "none"],
  [APP_STARTED_EVENT_TYPE, "none"],
]);
