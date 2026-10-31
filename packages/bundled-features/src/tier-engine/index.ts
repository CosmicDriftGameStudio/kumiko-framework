// Public API of the tier-engine bundled-feature.
//
// **What downstream apps import:**
//   - `tierEngineFeature` — register at app boot via runProdApp/setupTestStack
//   - `composeApp` — call to derive feature-set + caps from tier+addOns
//   - `TierMap` / `AddOnMap` — types for the app's own tier/add-on definitions
//   - `tierAssignmentEntity` — for migrations + drizzle-schema-generation
//   - `TierEngineHandlers` / `TierEngineQueries` — qualified handler names

export { tierAssignmentAggregateId } from "./aggregate-id.ts";
export { capsForTierFromMap } from "./caps-for-tier-from-map.ts";
export {
  type AddOnDefinition,
  type AddOnMap,
  type ComposeAppInput,
  type ComposedApp,
  composeApp,
  type TierDefinition,
  type TierMap,
} from "./compose-app.ts";
export { tierAssignmentEntity } from "./entity.ts";
export {
  type CreateTierEngineOptions,
  createTierEngineFeature,
} from "./feature.ts";
export {
  createTierOptionGate,
  type TierOptionAvailability,
  type TierOptionGate,
  type TierOptionGateDeps,
  type TierOptionSpec,
} from "./tier-option-gate.ts";
export {
  createTierResolver,
  type TierResolver,
  type TierResolverDeps,
} from "./tier-resolver.ts";
export { isTrialActive, type TrialPolicy } from "./trial.ts";
export {
  isTierAssignmentSource,
  TIER_ENGINE_FEATURE,
  type TierAssignmentSource,
  TierAssignmentSources,
  TierEngineHandlers,
  TierEngineQueries,
} from "./web/constants.ts";
