// Legacy re-export shim — fetchOne lebt jetzt in src/bun-db/query.ts.

export type { WhereObject } from "../db/query";
export { fetchOne } from "../db/query";
