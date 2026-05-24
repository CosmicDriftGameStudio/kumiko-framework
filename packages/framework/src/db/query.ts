// Provider-neutrale Query-API. Re-exported aus bun-db/query.
// Alle Consumer importieren von hier, nicht direkt aus bun-db/.
export {
  asRawClient,
  deleteMany,
  fetchOne,
  insertMany,
  insertOne,
  selectMany,
  updateMany,
  transaction,
  type AnyDb,
  type WhereObject,
  type WhereOperator,
  type WhereValue,
  type OrderByClause,
  type SelectOptions,
} from "../bun-db/query";
