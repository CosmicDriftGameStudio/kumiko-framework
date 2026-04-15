// All framework constants as `as const` objects with inferred union types.
// No enums — only const objects + typeof inference.

// Error codes — the canonical list lives on the KumikoError subclasses in
// `errors/classes.ts`. Features that need to surface a feature-specific reason
// attach it under `details.reason` on the relevant Kumiko error class.

// --- System Hook Names ---

export const SystemHookNames = {
  searchIndex: "system:hook:search-index",
  searchRemove: "system:hook:search-remove",
  sseBroadcast: "system:hook:sse-broadcast",
  sseDeleteBroadcast: "system:hook:sse-delete-broadcast",
  auditTrail: "system:hook:audit-trail",
  auditTrailDelete: "system:hook:audit-trail-delete",
  cascadeDelete: "system:hook:cascade-delete",
} as const;

export type SystemHookName = (typeof SystemHookNames)[keyof typeof SystemHookNames];

// --- System Hook Priorities ---

export const SystemHookPriorities = {
  cascadeDelete: 500,
  searchIndex: 1000,
  searchRemove: 1000,
  sseBroadcast: 1001,
  sseDeleteBroadcast: 1001,
  auditTrail: 1002,
  auditTrailDelete: 1002,
} as const;

// --- Message Kinds ---

export const MessageKind = {
  write: "write",
  query: "query",
  command: "command",
  shared: "shared",
  broadcast: "broadcast",
} as const;

export type MessageKind = (typeof MessageKind)[keyof typeof MessageKind];

// --- Lifecycle Hook Types ---

export const LifecycleHookTypes = {
  preSave: "preSave",
  postSave: "postSave",
  preDelete: "preDelete",
  postDelete: "postDelete",
  preQuery: "preQuery",
} as const;

export type LifecycleHookType = (typeof LifecycleHookTypes)[keyof typeof LifecycleHookTypes];

// --- Config Scopes ---

export const ConfigScopes = {
  system: "system",
  tenant: "tenant",
  user: "user",
} as const;

export type ConfigScope = (typeof ConfigScopes)[keyof typeof ConfigScopes];

// --- On Delete Strategies ---

export const OnDeleteStrategies = {
  cascade: "cascade",
  restrict: "restrict",
  setNull: "setNull",
  nothing: "nothing",
} as const;

export type OnDeleteStrategy = (typeof OnDeleteStrategies)[keyof typeof OnDeleteStrategies];

// --- Concurrency Modes ---

export const ConcurrencyModes = {
  parallel: "parallel",
  skip: "skip",
  replace: "replace",
  sequential: "sequential",
  debounce: "debounce",
} as const;

export type ConcurrencyMode = (typeof ConcurrencyModes)[keyof typeof ConcurrencyModes];

// --- SSE Channels ---

export function tenantChannel(tenantId: number): string {
  return `tenant:${tenantId}`;
}
