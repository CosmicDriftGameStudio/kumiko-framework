// Shared delivery-attempt event writer. Used both synchronously by the
// delivery-service (inline channels, skips) and asynchronously by the
// delivery.render / delivery.send job handlers — keeping the append +
// inline-projection logic in one place so both paths produce identical rows.

import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { Registry } from "@cosmicdrift/kumiko-framework/engine";
import { append, getStreamVersion } from "@cosmicdrift/kumiko-framework/event-store";
import { runProjectionsForEvent } from "@cosmicdrift/kumiko-framework/pipeline";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { DELIVERY_ATTEMPT_EVENT, DELIVERY_CHANNEL_EXTENSION } from "./constants.js";
import { deliveryAttemptSchema } from "./events.js";
import { maskRecipientAddress } from "./mask-recipient-address.js";
import { type DeliveryLogEntry, isDeliveryChannelPlugin } from "./types.js";

// Unknown channels count as personal: masking is the fail-closed default.
function addressIsConnectionName(registry: Registry, channelName: string): boolean {
  return registry
    .getExtensionUsages(DELIVERY_CHANNEL_EXTENSION)
    .some(
      (usage) =>
        usage.entityName === channelName &&
        isDeliveryChannelPlugin(usage.options) &&
        usage.options.addressKind === "connection-name",
    );
}

function loggedAddress(registry: Registry, entry: DeliveryLogEntry): string | null {
  return addressIsConnectionName(registry, entry.channel)
    ? entry.recipientAddress
    : maskRecipientAddress(entry.recipientAddress);
}

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
  // Masked here, the only place attempt events are written, so no event or projection row ever holds the full address.
  // Schema-parse to match ctx.appendEvent's guarantee: a payload drift between
  // service/job + feature-registration fails loudly here instead of landing on
  // the events-table and crashing a consumer later.
  const payload = deliveryAttemptSchema.parse({
    ...rest,
    recipientAddress: loggedAddress(registry, entry),
  });
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
