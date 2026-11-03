import { isAgentToolCallScope } from "../api/request-context-scopes.ts";
import type { Registry } from "../engine/types/index.ts";

// A global entity's rows are shared reference data every tenant already reads in tenant mode, so an
// agent tool call may run the query convention handler of a system-scope feature that serves one.
export function isGlobalEntityReadInAgentToolCall(registry: Registry, type: string): boolean {
  if (!isAgentToolCallScope() || !registry.getQueryHandler(type)) return false;
  const entityName = registry.getHandlerEntity(type);
  return entityName !== undefined && registry.getEntity(entityName)?.tenancy === "global";
}

// What the dispatcher treats as system scope for this handler: the feature flag, minus the
// agent-tool-call global-read carve-out, which runs with the caller's tenant scope.
export function isEffectivelySystemScoped(registry: Registry, type: string): boolean {
  return registry.isHandlerSystemScoped(type) && !isGlobalEntityReadInAgentToolCall(registry, type);
}
