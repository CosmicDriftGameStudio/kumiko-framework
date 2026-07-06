// @runtime client
export const FEATURE_TOGGLES_FEATURE = "feature-toggles" as const;

// Fully-qualified event name for feature-toggle changes. Kept as a constant
// so write-handler + tests reference one source.
export const FEATURE_TOGGLE_SET_EVENT_NAME = "feature-toggles:event:toggle-set";

// Aggregate type for toggle-set events. Shares the feature name to keep the
// events-table grep-friendly: every row belonging to this feature carries
// "feature-toggles" in its aggregate_type column.
export const FEATURE_TOGGLE_AGGREGATE_TYPE = "feature-toggles";

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

export const FeatureToggleHandlers = {
  set: "feature-toggles:write:set",
} as const;

export const FeatureToggleQueries = {
  list: "feature-toggles:query:list",
  registered: "feature-toggles:query:registered",
} as const;

export const TOGGLE_ADMIN_SCREEN_ID = "toggle-admin" as const;
