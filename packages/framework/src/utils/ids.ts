import { v7 } from "uuid";

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
export function generateId(): string {
  return v7();
}
