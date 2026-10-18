// Public API of the cap-counter bundled-feature.

export { capCounterAggregateId, rollingCapAggregateId } from "./aggregate-id.ts";
export {
  type BookCapUsageOptions,
  bookCapUsage,
  type MarkCapSoftWarnedOptions,
  markCapSoftWarned,
  type ReadRollingCapUsageOptions,
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
export {
  CAP_COUNTER_FEATURE,
  CAP_COUNTER_ROLLING_AGGREGATE_TYPE,
  CapCounterHandlers,
  CapCounterQueries,
  ROLLING_INCREMENTED_EVENT_QN,
  ROLLING_INCREMENTED_EVENT_SHORT,
  ROLLING_RELEASED_EVENT_QN,
  ROLLING_RELEASED_EVENT_SHORT,
} from "./constants.ts";
export {
  CAP_TOLERANCES,
  CapExceededError,
  type CapToleranceProfile,
  type CapToleranceProfileName,
  calendarMonthPeriodEndIso,
  currentCalendarMonthStartIso,
  type EnforceCapResult,
  enforceCap,
  enforceCapAndMaybeNotify,
  enforceRollingCap,
  enforceRollingCapAndMaybeNotify,
  enforceStockCap,
  type SoftHitNotifier,
  type StockCapResult,
} from "./enforce-cap.ts";
export { capCounterEntity } from "./entity.ts";
export { createCapCounterFeature } from "./feature.ts";
export { readPayloadField } from "./payload-field.ts";
export {
  type CapGuardContext,
  type CapLimitContext,
  createStockCapGuard,
  type StockCapGuard,
  type StockCapSpec,
} from "./stock-cap-guard.ts";
export { capReservationsTable, capReservationsTableMeta } from "./tables.ts";
export {
  createValueCapGuard,
  type ValueCapGuard,
  type ValueCapSpec,
} from "./value-cap-guard.ts";
export {
  type CalendarCapDef,
  type CalendarCapResolver,
  type RollingCapDef,
  type RollingCapResolver,
  withCapEnforcement,
  withRollingCapEnforcement,
} from "./with-cap-enforcement.ts";
