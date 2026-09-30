// Public API of the tier-engine bundled-feature.
//
// **What downstream apps import:**
//   - `tierEngineFeature` — register at app boot via runProdApp/setupTestStack
//   - `composeApp` — call to derive feature-set + caps from tier+addOns
//   - `TierMap` / `AddOnMap` — types for the app's own tier/add-on definitions
//   - `tierAssignmentEntity` — for migrations + drizzle-schema-generation
//   - `TierEngineHandlers` / `TierEngineQueries` — qualified handler names

export { tierAssignmentAggregateId } from "./aggregate-id.js";
export {
  type AddOnDefinition,
  type AddOnMap,
  type ComposeAppInput,
  type ComposedApp,
  composeApp,
  type TierDefinition,
  type TierMap,
} from "./compose-app.js";
export { TIER_ENGINE_FEATURE, TierEngineHandlers, TierEngineQueries } from "./constants.js";
export { tierAssignmentEntity } from "./entity.js";
export {
  type CreateTierEngineOptions,
  createTierEngineFeature,
  tierEngineFeature,
} from "./feature.js";
export {
  createTierResolver,
  type TierResolver,
  type TierResolverDeps,
} from "./tier-resolver.js";
export { isTrialActive, type TrialPolicy } from "./trial.js";
