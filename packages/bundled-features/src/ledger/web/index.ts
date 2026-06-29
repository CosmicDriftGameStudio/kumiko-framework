// @runtime client
// Client-safe ledger surface: QN constants + the pure recurring helpers
// (projection + Soll/Ist merge), nothing else. The full `../ledger` entry
// re-exports the feature/handlers/executor, which pull bun-db/postgres — a
// browser bundle that imports from there fails on Node builtins. A client screen
// (e.g. a rent-cashflow view) imports the dispatch QNs + the pure forecast/merge
// from HERE, then dispatches via the renderer's useDispatcher.

export {
  ACCOUNT_TYPES,
  type AccountType,
  LEDGER_FEATURE_NAME,
  LedgerHandlers,
  LedgerQueries,
  SCHEDULE_INTERVALS,
  type ScheduleInterval,
  TRANSACTION_STATUS,
  type TransactionStatus,
} from "../constants";
export {
  type LedgerTxRow,
  mergeScheduleActuals,
  type ProjectedPeriod,
  projectSchedule,
  type ScheduleDef,
  type ScheduleMonth,
  type ScheduleMonthStatus,
  scheduleReference,
} from "../recurring";
export {
  type ConfirmSchedulePeriodPayload,
  confirmSchedulePeriodPayloadSchema,
  type Posting,
  postingSchema,
} from "../schemas";
