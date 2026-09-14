import { v5, v7 } from "uuid";

// Non-secret identifiers for DB rows, event streams, correlation/request
// IDs, SSE connections, distributed locks. UUIDv7: first 48 bits are a
// Unix-ms timestamp, remaining 74 bits are random. Lexicographic order
// matches chronological order, so B-Tree indexes stay dense on insert
// and time-range queries ("events for stream X since T") read sequential
// pages. Universal-safe — uses the `uuid` npm package, not `node:crypto`,
// so the same call works in Bun, Node, Metro/RN, and Expo-Web bundles.
//
// Do NOT use this for security tokens (CSRF, session, API keys). The
// timestamp prefix leaks creation time and shrinks unpredictable
// entropy from 122 to 74 bits — use `generateToken` from api/tokens.ts.
// @wrapper-known semantic-alias
export function generateId(): string {
  return v7();
}

// RFC 4122 §4.3: our own namespace UUID, derived from a DNS name under the
// standard DNS namespace rather than a hand-picked constant — deterministic
// and reproducible, no external id-generation tool needed.
const DETERMINISTIC_ID_NAMESPACE = v5("kumiko.rocks", v5.DNS);

// UUIDv5 (content-addressed, not v7): the same (namespace, key) always
// yields the same id, so a redelivered event lands on the same row instead
// of a duplicate. This id space is per entity table, not per tenant — fold
// the tenant id into `key` or a redelivery from a different tenant collides.
export function generateDeterministicId(namespace: string, key: string): string {
  return v5(`${namespace}:${key}`, DETERMINISTIC_ID_NAMESPACE);
}
