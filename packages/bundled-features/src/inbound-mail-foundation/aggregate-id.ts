import { v5 as uuidv5 } from "uuid";

// Fixed UUID namespaces for deterministic aggregate-ID derivation.
// Generated once (2026-07-12) and immutable: changing one would re-key
// every existing aggregate stream, breaking message history and idempotency.
// Drift is pinned in __tests__/feature.test.ts.

/** Namespace for inbound-message streams. */
const INBOUND_MESSAGE_NAMESPACE = "7f2a9c41-3d6b-4e0f-9c58-2b1e7a4d8f63";

/** Namespace for mail-thread streams. */
const MAIL_THREAD_NAMESPACE = "b48d1e72-5c9a-4f36-8e0d-6a3f9b2c7e15";

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
// @wrapper-known uuid-domain
export function inboundMessageAggregateId(accountId: string, providerMessageId: string): string {
  return uuidv5(`${accountId}:${providerMessageId}`, INBOUND_MESSAGE_NAMESPACE);
}

/**
 * Deterministic aggregate ID for a mail thread. The key is
 * (tenantId, threadKey): threads are tenant-wide, not account-specific, so a
 * conversation spanning two connected inboxes is one thread. threadKey is
 * normalized by the provider (References/In-Reply-To chain or provider
 * thread ID).
 */
// @wrapper-known uuid-domain
export function mailThreadAggregateId(tenantId: string, threadKey: string): string {
  return uuidv5(`${tenantId}:${threadKey}`, MAIL_THREAD_NAMESPACE);
}
