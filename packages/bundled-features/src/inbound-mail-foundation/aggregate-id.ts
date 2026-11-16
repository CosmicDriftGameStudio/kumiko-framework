import { v5 as uuidv5 } from "uuid";

// Fixed UUID namespaces for deterministic aggregate-ID derivation.
// Generated once (2026-07-12) and immutable: changing one would re-key
// every existing aggregate stream, breaking message history and idempotency.
// Drift is pinned in __tests__/feature.test.ts.

/** Namespace for inbound-message streams. */
const INBOUND_MESSAGE_NAMESPACE = "7f2a9c41-3d6b-4e0f-9c58-2b1e7a4d8f63";

/**
 * Deterministic aggregate ID for an inbound message. The key is
 * (accountId, providerMessageId): if the provider delivers the same message
 * twice (IDLE duplicate notification, cursor overlap, watch-restart replay),
 * both deliveries use the same stream, so the idempotency check in the
 * ingest handler sees the event that was already appended.
 *
 * accountId, rather than tenantId, is part of the key because two accounts in
 * the same tenant can receive the same email (CC'd to both inboxes); these
 * are two distinct inbound messages.
 */
export function inboundMessageAggregateId(accountId: string, providerMessageId: string): string {
  return uuidv5(`${accountId}:${providerMessageId}`, INBOUND_MESSAGE_NAMESPACE);
}
