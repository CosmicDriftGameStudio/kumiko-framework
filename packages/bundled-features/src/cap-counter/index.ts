// Public API of the cap-counter bundled-feature.

export { capCounterAggregateId, rollingCapAggregateId } from "./aggregate-id";
export {
  CAP_COUNTER_FEATURE,
  CAP_COUNTER_ROLLING_AGGREGATE_TYPE,
  CapCounterHandlers,
  CapCounterQueries,
  ROLLING_INCREMENTED_EVENT_QN,
  ROLLING_INCREMENTED_EVENT_SHORT,
} from "./constants";
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
  type SoftHitNotifier,
} from "./enforce-cap";
export { capCounterEntity } from "./entity";
export { capCounterFeature } from "./feature";
export {
  type CalendarCapDef,
  type CalendarCapResolver,
  type RollingCapDef,
  type RollingCapResolver,
  withCapEnforcement,
  withRollingCapEnforcement,
} from "./with-cap-enforcement";
