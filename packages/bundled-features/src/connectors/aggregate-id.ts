import { v5 as uuidv5 } from "uuid";

// Generated once (2026-11-19) and immutable: changing it re-keys every inbound-item stream and
// breaks the "same file again is the same item" guarantee.
const INBOUND_ITEM_NAMESPACE = "c3b6d0a4-5f1e-4d7a-9a52-8e41b7c2f906";

// A deleted item's stream stays unusable, so a file delivered again after its deletion takes the next generation.
export function inboundItemAggregateId(
  connectorId: string,
  sha256: string,
  relativePath: string,
  generation = 0,
): string {
  const base = `${connectorId}:${sha256}:${relativePath}`;
  return uuidv5(generation === 0 ? base : `${base}#${generation}`, INBOUND_ITEM_NAMESPACE);
}

// Same rule as the namespace above, for the folder tree.
const INBOUND_FOLDER_NAMESPACE = "7e2a91f4-0b6d-4c38-a5d1-3f9c82b4e7a1";

// Deterministic so parallel uploads into a new folder all name the same stream: one create wins,
// the others see a conflict and reuse it. A forgotten or deleting folder leaves its stream unusable,
// so the next folder of that name takes the next generation.
export function inboundFolderAggregateId(
  connectorId: string,
  parentId: string | null,
  name: string,
  generation = 0,
): string {
  const base = `${connectorId}:${parentId ?? ""}:${name}`;
  return uuidv5(generation === 0 ? base : `${base}#${generation}`, INBOUND_FOLDER_NAMESPACE);
}
