// Shared delivery-attempt event writer. Used both synchronously by the
// delivery-service (inline channels, skips) and asynchronously by the
// delivery.render / delivery.send job handlers — keeping the append +
// inline-projection logic in one place so both paths produce identical rows.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { append, getStreamVersion } from "@cosmicdrift/kumiko-framework/event-store";
import { runProjectionsForEvent } from "@cosmicdrift/kumiko-framework/pipeline";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { DELIVERY_ATTEMPT_EVENT } from "./constants";
import { deliveryAttemptSchema } from "./events";
import type { DeliveryLogEntry } from "./types";

// Append one delivery-attempt event to `attemptId`'s stream and run the inline
// `delivery-log` projection in the same write (low-level append() does not
// auto-fire projections — only the dispatcher/executor paths do). getStreamVersion
// returns 0 for a fresh stream, so the same call serves both the first event
// (queued, or a single-shot terminal) and follow-ups (queued → sent/failed).
export async function appendAttemptEvent(
  db: DbConnection,
  registry: Registry,
  attemptId: string,
  entry: DeliveryLogEntry,
): Promise<void> {
  const { tenantId, ...rest } = entry;
  // Schema-parse to match ctx.appendEvent's guarantee: a payload drift between
  // service/job + feature-registration fails loudly here instead of landing on
  // the events-table and crashing a consumer later.
  const payload = deliveryAttemptSchema.parse(rest);
  const expectedVersion = await getStreamVersion(db, attemptId, tenantId);
  const stored = await append(db, {
    aggregateId: attemptId,
    aggregateType: "deliveryAttempt",
    tenantId,
    expectedVersion,
    type: DELIVERY_ATTEMPT_EVENT,
    payload,
    metadata: { userId: "system" },
  });
  await runProjectionsForEvent(stored, registry, db);
}

// Single-shot terminal log (inline channels, skips, idempotency dups): fresh
// aggregate id, one event.
export async function logAttempt(
  db: DbConnection,
  registry: Registry,
  entry: DeliveryLogEntry,
): Promise<string> {
  const attemptId = generateId();
  await appendAttemptEvent(db, registry, attemptId, entry);
  return attemptId;
}
