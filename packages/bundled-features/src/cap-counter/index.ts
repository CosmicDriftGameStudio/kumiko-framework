// Public API of the cap-counter bundled-feature.

export { capCounterAggregateId } from "./aggregate-id";
export {
  CAP_COUNTER_FEATURE,
  CapCounterHandlers,
  CapCounterQueries,
} from "./constants";
export {
  CAP_TOLERANCES,
  CapExceededError,
  type CapToleranceProfile,
  type CapToleranceProfileName,
  currentCalendarMonthStartIso,
  type EnforceCapResult,
  enforceCap,
  ROLLING_WINDOW_PERIOD,
} from "./enforce-cap";
export { capCounterEntity } from "./entity";
export { capCounterFeature } from "./feature";
