import { v5 as uuidv5 } from "uuid";

// Generated once (2026-11-19) and immutable: changing it re-keys every inbound-item stream and
// breaks the "same file again is the same item" guarantee.
const INBOUND_ITEM_NAMESPACE = "c3b6d0a4-5f1e-4d7a-9a52-8e41b7c2f906";

export function inboundItemAggregateId(
  connectorId: string,
  sha256: string,
  relativePath: string,
): string {
  return uuidv5(`${connectorId}:${sha256}:${relativePath}`, INBOUND_ITEM_NAMESPACE);
}
