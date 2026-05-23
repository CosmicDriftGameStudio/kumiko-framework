// Legacy re-export shim — fetchOne lebt jetzt in src/bun-db/query.ts.

export type { WhereObject } from "../bun-db/query";
export { fetchOne } from "../bun-db/query";
