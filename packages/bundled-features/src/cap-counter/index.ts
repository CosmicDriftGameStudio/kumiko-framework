// Public API of the cap-counter bundled-feature.

export { capCounterAggregateId, rollingCapAggregateId } from "./aggregate-id.js";
export {
  type BookCapUsageOptions,
  bookCapUsage,
  type MarkCapSoftWarnedOptions,
  markCapSoftWarned,
  type ReadRollingCapUsageOptions,
  readRollingCapUsage,
} from "./book-cap-usage.js";
export {
  CAP_COUNTER_FEATURE,
  CAP_COUNTER_ROLLING_AGGREGATE_TYPE,
  CapCounterHandlers,
  CapCounterQueries,
  ROLLING_INCREMENTED_EVENT_QN,
  ROLLING_INCREMENTED_EVENT_SHORT,
} from "./constants.js";
export {
  CAP_TOLERANCES,
  CapExceededError,
  type CapToleranceProfile,
  type CapToleranceProfileName,
  currentCalendarMonthStartIso,
  type EnforceCapResult,
  enforceCap,
  enforceCapAndMaybeNotify,
  enforceRollingCap,
  enforceRollingCapAndMaybeNotify,
  enforceStockCap,
  type SoftHitNotifier,
  type StockCapResult,
} from "./enforce-cap.js";
export { capCounterEntity } from "./entity.js";
export { capCounterFeature } from "./feature.js";
export {
  type CapLimitContext,
  createStockCapGuard,
  type StockCapGuard,
  type StockCapSpec,
} from "./stock-cap-guard.js";
export {
  type CalendarCapDef,
  type CalendarCapResolver,
  type RollingCapDef,
  type RollingCapResolver,
  withCapEnforcement,
  withRollingCapEnforcement,
} from "./with-cap-enforcement.js";
