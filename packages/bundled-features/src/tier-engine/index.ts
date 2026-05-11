// Public API of the tier-engine bundled-feature.
//
// **What downstream apps import:**
//   - `tierEngineFeature` — register at app boot via runProdApp/setupTestStack
//   - `composeApp` — call to derive feature-set + caps from tier+addOns
//   - `TierMap` / `AddOnMap` — types for the app's own tier/add-on definitions
//   - `tierAssignmentEntity` — for migrations + drizzle-schema-generation
//   - `TierEngineHandlers` / `TierEngineQueries` — qualified handler names

export { tierAssignmentAggregateId } from "./aggregate-id";
export {
  type AddOnDefinition,
  type AddOnMap,
  type ComposeAppInput,
  type ComposedApp,
  composeApp,
  type TierDefinition,
  type TierMap,
} from "./compose-app";
export { TIER_ENGINE_FEATURE, TierEngineHandlers, TierEngineQueries } from "./constants";
export { tierAssignmentEntity } from "./entity";
export {
  type CreateTierEngineOptions,
  createTierEngineFeature,
  tierEngineFeature,
} from "./feature";
