// Public API of the cap-counter bundled-feature.

export { capCounterAggregateId } from "./aggregate-id.ts";
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
  CapCounterHandlers,
  CapCounterQueries,
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
  type CalendarCapDef,
  type CalendarCapResolver,
  withCapEnforcement,
} from "./with-cap-enforcement.ts";
