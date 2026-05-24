// Provider-neutrale Query-API. Re-exported aus bun-db/query.
// Alle Consumer importieren von hier, nicht direkt aus bun-db/.
export {
  type AnyDb,
  asRawClient,
  coerceRow,
  deleteMany,
  extractTableInfo,
  fetchOne,
  insertMany,
  insertOne,
  type OrderByClause,
  type SelectOptions,
  selectMany,
  type TableInfo,
  transaction,
  updateMany,
  type WhereObject,
  type WhereOperator,
  type WhereValue,
} from "../bun-db/query";
