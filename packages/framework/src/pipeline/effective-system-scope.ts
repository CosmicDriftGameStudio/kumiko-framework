import { ENTITY_CONVENTION_QUERY_BRAND } from "@cosmicdrift/kumiko-types/handlers";
import { isAgentToolCallScope } from "../api/request-context-scopes.ts";
import type { Registry } from "../engine/types/index.ts";

// A global entity's rows are shared reference data every tenant already reads in tenant mode, so an
// agent tool call may run the generated list/detail query of a system-scope feature that serves
// one. A hand-written query could do anything with system scope, and an escapeHatch (e.g.
// systemIdentity) must never run on behalf of the LLM, so both stay refused.
export function isGlobalEntityReadInAgentToolCall(registry: Registry, type: string): boolean {
  if (!isAgentToolCallScope()) return false;
  const handler = registry.getQueryHandler(type);
  if (handler === undefined || handler[ENTITY_CONVENTION_QUERY_BRAND] !== true) return false;
  if (handler.escapeHatch !== undefined) return false;
  const entityName = registry.getHandlerEntity(type);
  return entityName !== undefined && registry.getEntity(entityName)?.tenancy === "global";
}

// What the dispatcher treats as system scope for this handler: the feature flag, minus the
// agent-tool-call global-read carve-out, which runs with the caller's tenant scope.
export function isEffectivelySystemScoped(registry: Registry, type: string): boolean {
  return registry.isHandlerSystemScoped(type) && !isGlobalEntityReadInAgentToolCall(registry, type);
}
