import { v5 as uuidv5 } from "uuid";
import type { WhatsappStatusKind } from "./constants.ts";

const UNRECOGNISED_STATUS: WhatsappStatusKind = "other";

// Fixed namespaces, generated once and immutable: changing one re-keys every existing
// stream and breaks the dedupe of redelivered webhooks.
const MESSAGE_NAMESPACE = "3e6a1b94-7d2c-4f58-a0c3-91e4b5d27f08";
const STATUS_NAMESPACE = "8b0f4d27-61a9-4c3e-b7d5-2a9e0c14f6b3";

/** One stream per (tenant, wamid): a redelivered message lands on the stream that already exists. */
export function whatsappMessageAggregateId(tenantId: string, wamid: string): string {
  return uuidv5(`${tenantId}:${wamid}`, MESSAGE_NAMESPACE);
}

/**
 * One stream per (tenant, wamid, status): Meta reports each status of a sent message once.
 * An unrecognised status is keyed by Meta's own word so different new statuses do not collide.
 */
export function whatsappStatusAggregateId(
  tenantId: string,
  wamid: string,
  status: WhatsappStatusKind,
  rawStatus: string | null = null,
): string {
  const key =
    status === UNRECOGNISED_STATUS && rawStatus !== null && rawStatus !== "" ? rawStatus : status;
  return uuidv5(`${tenantId}:${wamid}:${key}`, STATUS_NAMESPACE);
}
