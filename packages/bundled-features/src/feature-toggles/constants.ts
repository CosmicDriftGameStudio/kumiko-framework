// Fully-qualified event name for feature-toggle changes. Kept as a constant
// so write-handler + tests reference one source.
export const FEATURE_TOGGLE_SET_EVENT_NAME = "feature-toggles:event:toggle-set";

// Aggregate type used when appending toggle events. One stream per feature,
// aggregateId = featureName (stable, human-readable — no UUID indirection
// needed since there's only ever one row per feature). Archive-aware code
// that requires UUID aggregate-ids doesn't apply here: toggle streams are
// never archived.
export const FEATURE_TOGGLE_AGGREGATE_TYPE = "feature-toggle";

// Error reasons surfaced from feature-toggle handlers. Scoped to the
// feature's namespace per the framework's reason-convention.
export const FeatureToggleErrors = {
  // set-handler attempted to toggle a feature that didn't declare
  // r.toggleable(). The dispatcher's gate ignores such features anyway,
  // but writing a row for them would create the illusion of configurability.
  notToggleable: "feature_not_toggleable",
  // set-handler attempted to toggle a feature name that isn't registered.
  // Prevents typos from silently piling up orphan rows.
  unknownFeature: "unknown_feature",
} as const;
