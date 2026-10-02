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
// The docs site (`errors/` pages) reads this source; the enterprise repo keeps
// its own AGENT_REASONS, so only reasons it actually emits belong in both.

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

  // AccessDeniedError: a handler/hook called ctx.queryAs/ctx.writeAs with a
  // SYSTEM identity without an r.systemScope() feature or a declared escapeHatch.
  systemIdentitySwitchDenied: "system_identity_switch_denied",

  // AccessDeniedError: a handler/hook called ctx.queryAs/ctx.writeAs with a
  // non-SYSTEM identity other than its own caller (different user, tenant,
  // claims, origin or extra roles) without r.systemScope() or escapeHatch.
  identitySwitchDenied: "identity_switch_denied",

  // AccessDeniedError: a handler/hook called ctx.queryProjection(..., { unsafeAllTenants: true })
  // without an r.systemScope() feature or a declared escapeHatch.
  unsafeAllTenantsDenied: "unsafe_all_tenants_denied",

  // AccessDeniedError: ctx.queryAsMember's userId is not an active member of
  // ctx's tenant. Deliberately generic — a caller can't probe which check failed.
  memberResolutionDenied: "member_resolution_denied",

  // AccessDeniedError: a query handler invoked via ctx.queryAsMember tried to
  // write — a resolved member principal is read-only by construction.
  memberResolutionReadOnly: "member_resolution_read_only",

  // AccessDeniedError: a write under an anonymous root touched a personal-data field
  // without the root handler declaring access.personalData: "public-intake".
  publicIntakeRequired: "public_intake_required",

  // AccessDeniedError: the directly-dispatched entry handler performs a hard
  // delete/forget but its agent.risk resolves below "high" — delegation via
  // ctx.write/writeAs from a lower-risk handler does not inherit the gate.
  irreversibleOperationRequiresHighRisk: "irreversible_operation_requires_high_risk",

  // AccessDeniedError: the directly-dispatched entry handler writes a field
  // flagged readAsInstruction: true but its agent.risk resolves below "high" —
  // delegation via ctx.write/writeAs from a lower-risk handler does not
  // inherit the gate.
  instructionFieldWriteRequiresHighRisk: "instruction_field_write_requires_high_risk",
} as const;

export type FrameworkReason = (typeof FrameworkReasons)[keyof typeof FrameworkReasons];

// Reason codes the AI-agent runtime surfaces via `details.reason`. Kept as a
// sister catalog to FrameworkReasons instead of extending it — see the
// file-header note above for why these carry the `agent.` prefix.
export const AgentReasons = {
  // Error turn in the agent loop when the model requests a tool outside the
  // run's catalog; UnprocessableError in rule validation (handler missing from
  // the caller's role-filtered manifest, or `ai-agent-edit` not mounted).
  toolNotAllowed: "agent.tool_not_allowed",

  // Not thrown: the run ends with a `clarify` turn (`payload.reason`) once
  // MAX_AGENT_ROUNDS is reached.
  iterationLimit: "agent.iteration_limit",

  // UnprocessableError: a permission rule with `always` was requested for an
  // `agent: { risk: "high" }` handler; `details.handlerQn` names it.
  highRiskNoAlways: "agent.high_risk_no_always",
} as const;

export type AgentReason = (typeof AgentReasons)[keyof typeof AgentReasons];
