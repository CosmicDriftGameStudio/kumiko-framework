// Public API of the cap-counter bundled-feature.

export {
  type BookCapUsageOptions,
  bookCapUsage,
  type MarkCapSoftWarnedOptions,
  markCapSoftWarned,
  type ReadRollingCapUsageOptions,
  readCalendarCapCounter,
  readCalendarCapUsageByTenant,
  readRollingCapUsage,
} from "./book-cap-usage.ts";
export {
  type CalendarCapReservationHandle,
  type CalendarCapReservationHandleSpec,
  type CalendarCapUsageReservation,
  type CalendarCapUsageReservationSpec,
  calendarCapReservationHandle,
  reserveCalendarCapUsage,
} from "./calendar-cap-usage-reservation.ts";
export {
  CapReservationOverConsumedError,
  CapReservationSettledError,
  CapSettleBelowConsumedError,
} from "./cap-reservation.ts";
export { type CapSubject, forgetCapCounterSubject } from "./cap-subject.ts";
export {
  CAP_COUNTER_FEATURE,
  CapCounterHandlers,
  CapCounterQueries,
  DEFAULT_AI_CAP_SUBJECT_SHARE,
} from "./constants.ts";
export {
  CAP_TOLERANCES,
  CapExceededError,
  type CapLimitScope,
  type CapToleranceProfile,
  type CapToleranceProfileName,
  calendarMonthPeriodEndIso,
  currentCalendarMonthStartIso,
  type EnforceCapResult,
  enforceCap,
  enforceCapAndMaybeNotify,
  enforceStockCap,
  type SoftHitNotifier,
  type StockCapResult,
} from "./enforce-cap.ts";
export { createCapCounterFeature } from "./feature.ts";
export { readPayloadField } from "./payload-field.ts";
export {
  type CapGuardContext,
  type CapLimitContext,
  createStockCapGuard,
  type StockCapGuard,
  type StockCapSpec,
} from "./stock-cap-guard.ts";
export {
  capCountersTable,
  capCountersTableMeta,
  capReservationsTable,
  capReservationsTableMeta,
} from "./tables.ts";
export {
  type CalendarCapDef,
  type CalendarCapResolver,
  withCapEnforcement,
} from "./with-cap-enforcement.ts";
