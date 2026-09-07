// Centralized registry of the reason codes the framework itself surfaces via
// `details.reason`. Declaring them here keeps them typed + greppable, and
// gives features a single source of truth when they need to branch on the
// framework-level reason (e.g. "is this a stale-state race? retry once").
//
// Features add their own local Reasons objects (see `samples/errors/` or
// `packages/bundled-features/src/tenant/constants.ts` → TenantErrors). The
// framework deliberately does NOT enforce uniqueness across features — two
// features may use the same reason string if the semantics match. The
// convention: snake_case, no spaces, no feature prefix for framework reasons.
//
// AgentReasons below is a deliberate exception to "no feature prefix": those
// reasons surface from the AI-agent runtime (tool dispatch, permission and
// risk gates), not from a handler's own domain logic, and the `agent.`
// prefix keeps them visibly distinct from FrameworkReasons in error payloads.
// Both the docs site (`errors/` pages) and the enterprise repo read this same
// source, so the prefix stays a naming convention here, not a new registry.

export const FrameworkReasons = {
  // ConflictError: atomic UPDATE lost the race (another writer moved the row
  // between our snapshot and our WHERE clause). Client SDK default: toast +
  // re-fetch.
  staleState: "stale_state",

  // UnprocessableError: guardTransition rejected a state-machine transition.
  // Details carry `from`, `to`, and `validTargets` for debugging.
  invalidTransition: "invalid_transition",

  // AccessDeniedError: dispatcher's field-level write check blocked a field.
  // Details carry `field` and `handler`.
  fieldAccessDenied: "field_access_denied",

  // ConflictError: cascade-delete guard refused because dependent rows exist.
  // Details carry `blockingEntity`, `entity`, `entityId`.
  deleteRestricted: "delete_restricted",

  // FeatureDisabledError: handler's owning feature is globally disabled.
  // Distinct from access-denied — clients should surface "feature X is
  // currently unavailable" not "you don't have permission".
  featureDisabled: "feature_disabled",
} as const;

export type FrameworkReason = (typeof FrameworkReasons)[keyof typeof FrameworkReasons];

// Reason codes the AI-agent runtime surfaces via `details.reason`. Kept as a
// sister catalog to FrameworkReasons instead of extending it — see the
// file-header note above for why these carry the `agent.` prefix.
export const AgentReasons = {
  // AccessDeniedError: the agent called a tool name outside its allowed
  // catalog for this run.
  toolNotAllowed: "agent.tool_not_allowed",

  // UnprocessableError: the agent loop hit its maximum round count before
  // producing a final answer.
  iterationLimit: "agent.iteration_limit",

  // AccessDeniedError: the tool exists, but the caller's roles don't cover
  // the handler behind it.
  permissionDenied: "agent.permission_denied",

  // AccessDeniedError: an `agent.risk: "high"` handler was invoked without
  // the required explicit confirmation.
  highRiskNoAlways: "agent.high_risk_no_always",
} as const;

export type AgentReason = (typeof AgentReasons)[keyof typeof AgentReasons];
