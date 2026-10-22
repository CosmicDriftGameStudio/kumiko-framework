// Client-safe ledger surface: QN constants, pure recurring helpers
// (projection + Soll/Ist merge), and Zod payload schemas for client-side
// pre-validation before dispatch. The full `../ledger` entry also re-exports
// the feature/handlers/executor, which pull postgres-js; importing it in a
// browser bundle fails on Node builtins. Client screens import dispatch QNs and
// pure forecast/merge helpers from this module, then dispatch via the renderer's
// useDispatcher.

export {
  type LedgerTxRow,
  mergeScheduleActuals,
  type ProjectedPeriod,
  projectSchedule,
  type ScheduleDef,
  type ScheduleMonth,
  type ScheduleMonthStatus,
  scheduleReference,
} from "../recurring.ts";
export {
  type ConfirmSchedulePeriodPayload,
  confirmSchedulePeriodPayloadSchema,
  type Posting,
  postingSchema,
} from "../schemas.ts";
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
} from "./constants.ts";
