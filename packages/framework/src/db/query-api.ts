// Legacy re-export shim — query-api.ts hat früher drizzle gewrapped.
// Heute liegen die Helpers in src/bun-db/. Wir re-exportieren von dort
// damit existing imports `@cosmicdrift/kumiko-framework/db` weiterhin
// funktionieren während wir die Callers schrittweise auf den direkten
// bun-db-Import migrieren.

export type {
  SelectOptions,
  WhereObject,
  WhereOperator,
  WhereValue,
} from "../bun-db/query";
export {
  asRawClient,
  deleteMany,
  fetchOne,
  insertOne,
  selectMany,
  transaction,
  updateMany,
} from "../bun-db/query";
