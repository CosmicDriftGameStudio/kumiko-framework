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

// Shared append + inline-projection write (low-level append() does not
// auto-fire projections — only the dispatcher/executor paths do).
async function writeAttemptEvent(
  db: DbConnection,
  registry: Registry,
  attemptId: string,
  expectedVersion: number,
  entry: DeliveryLogEntry,
): Promise<void> {
  const { tenantId, ...rest } = entry;
  // Schema-parse to match ctx.appendEvent's guarantee: a payload drift between
  // service/job + feature-registration fails loudly here instead of landing on
  // the events-table and crashing a consumer later.
  const payload = deliveryAttemptSchema.parse(rest);
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

// Append one delivery-attempt event to `attemptId`'s stream — for the
// MULTI-EVENT path (queued → sent/failed follow-ups), where the stream may
// already carry the "queued" event and the real current version must be
// looked up.
export async function appendAttemptEvent(
  db: DbConnection,
  registry: Registry,
  attemptId: string,
  entry: DeliveryLogEntry,
): Promise<void> {
  const expectedVersion = await getStreamVersion(db, attemptId, entry.tenantId);
  await writeAttemptEvent(db, registry, attemptId, expectedVersion, entry);
}

// Single-shot terminal log (inline channels, skips, idempotency dups): a
// FRESH aggregate id is guaranteed version 0 — skip the getStreamVersion
// round-trip that appendAttemptEvent needs for its follow-up-event case.
export async function logAttempt(
  db: DbConnection,
  registry: Registry,
  entry: DeliveryLogEntry,
): Promise<string> {
  const attemptId = generateId();
  await writeAttemptEvent(db, registry, attemptId, 0, entry);
  return attemptId;
}
