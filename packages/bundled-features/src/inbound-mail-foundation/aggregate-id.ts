import { v5 as uuidv5 } from "uuid";

// Fixed UUID-namespaces für deterministic aggregate-id-Ableitung.
// Generiert einmalig (2026-07-12), in Stein gemeißelt: ein Wechsel würde
// jeden existing aggregate-Stream re-keyen → kaputte Message-Historie,
// kaputte Idempotency. Drift-Pins in __tests__/feature.test.ts.

/** Namespace für inbound-message-Streams. */
const INBOUND_MESSAGE_NAMESPACE = "7f2a9c41-3d6b-4e0f-9c58-2b1e7a4d8f63";

/** Namespace für mail-thread-Streams. */
const MAIL_THREAD_NAMESPACE = "b48d1e72-5c9a-4f36-8e0d-6a3f9b2c7e15";

/**
 * Deterministic aggregate-id für eine inbound-message. Key ist
 * (accountId, providerMessageId): derselbe Provider-Fetch der zweimal
 * dieselbe Message liefert (IDLE-Doppel-Notify, Cursor-Overlap,
 * Watch-Restart-Replay) landet auf demselben Stream — der Idempotency-
 * Check im ingest-handler sieht den bereits appendeten Event.
 *
 * accountId (nicht tenantId) im Key: zwei Accounts desselben Tenants
 * können dieselbe Mail empfangen (CC an beide Postfächer) — das sind
 * fachlich ZWEI inbound-messages.
 */
// @wrapper-known uuid-domain
export function inboundMessageAggregateId(accountId: string, providerMessageId: string): string {
  return uuidv5(`${accountId}:${providerMessageId}`, INBOUND_MESSAGE_NAMESPACE);
}

/**
 * Deterministic aggregate-id für einen mail-thread. Key ist
 * (tenantId, threadKey) — Threads sind tenant-weit, nicht account-weit:
 * eine Konversation die über zwei verbundene Postfächer läuft ist EIN
 * Thread. threadKey kommt normalisiert vom Provider (References/
 * In-Reply-To-Chain bzw. Provider-Thread-ID).
 */
// @wrapper-known uuid-domain
export function mailThreadAggregateId(tenantId: string, threadKey: string): string {
  return uuidv5(`${tenantId}:${threadKey}`, MAIL_THREAD_NAMESPACE);
}
