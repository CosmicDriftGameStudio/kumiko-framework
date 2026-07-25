import type { ConcurrencyMode } from "@cosmicdrift/kumiko-types/concurrency-mode";
import type { ConfigScope } from "@cosmicdrift/kumiko-types/config-scope";
import type { TenantId } from "./types/identifiers";

// All framework constants as `as const` objects with inferred union types.
// No enums — only const objects + typeof inference.

// Error codes — the canonical list lives on the KumikoError subclasses in
// `errors/classes.ts`. Features that need to surface a feature-specific reason
// attach it under `details.reason` on the relevant Kumiko error class.

// --- System Hook Names ---

export const SystemHookNames = {
  cascadeDelete: "system:hook:cascade-delete",
} as const;

export type SystemHookName = (typeof SystemHookNames)[keyof typeof SystemHookNames];

// --- System Hook Priorities ---

export const SystemHookPriorities = {
  cascadeDelete: 500,
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
  postQuery: "postQuery",
} as const;

export type LifecycleHookType = (typeof LifecycleHookTypes)[keyof typeof LifecycleHookTypes];

// --- Config Scopes ---
// Value object satisfies the canonical ConfigScope union from kumiko-types —
// a scope added here without a matching kumiko-types member is now a
// compile error instead of silent drift (#1423/#1439).

export const ConfigScopes = {
  system: "system",
  tenant: "tenant",
  user: "user",
} as const satisfies Record<string, ConfigScope>;

export type { ConfigScope };

// Reverse direction: a member added only to kumiko-types' ConfigScope
// (not to ConfigScopes above) would otherwise pass the `satisfies` check
// above unnoticed — this line forces exhaustiveness the other way too.
const _configScopeExhaustive: Record<ConfigScope, unknown> = ConfigScopes;
void _configScopeExhaustive;

// --- On Delete Strategies ---

export const OnDeleteStrategies = {
  cascade: "cascade",
  restrict: "restrict",
  setNull: "setNull",
  nothing: "nothing",
} as const;

export type OnDeleteStrategy = (typeof OnDeleteStrategies)[keyof typeof OnDeleteStrategies];

// --- Concurrency Modes ---
// Value object satisfies the canonical ConcurrencyMode union from
// kumiko-types — same drift-guard as ConfigScopes above.

export const ConcurrencyModes = {
  parallel: "parallel",
  skip: "skip",
  replace: "replace",
  sequential: "sequential",
  debounce: "debounce",
} as const satisfies Record<string, ConcurrencyMode>;

export type { ConcurrencyMode };

// Reverse-direction exhaustiveness guard — see the ConfigScope one above.
const _concurrencyModeExhaustive: Record<ConcurrencyMode, unknown> = ConcurrencyModes;
void _concurrencyModeExhaustive;

// --- SSE Channels ---

export function tenantChannel(tenantId: TenantId): string {
  return `tenant:${tenantId}`;
}
