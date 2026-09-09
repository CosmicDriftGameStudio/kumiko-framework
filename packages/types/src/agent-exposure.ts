import type { AgentExposure, AgentHandlerHints } from "./handlers";

/** Fail-closed: a handler without a `description` stays invisible to the agent
 *  unless it opts in explicitly. `kind` is a parameter because write and query
 *  handler definitions are structurally indistinguishable at runtime. */
export function resolveAgentExposure(
  def: { readonly description?: string; readonly agent?: AgentHandlerHints },
  kind: "query" | "write",
): AgentExposure {
  return {
    expose: def.agent?.expose ?? def.description !== undefined,
    risk: def.agent?.risk ?? (kind === "query" ? "low" : "mid"),
  };
}

/** Screens are the inverse of handlers: the manifest lists every role-visible
 *  screen regardless of `description`, so only an explicit opt-out hides one.
 *  Reusing `resolveAgentExposure`'s fail-closed default here would silently
 *  drop every screen without a description from the agent's view. */
export function isAgentVisibleScreen(screen: { readonly agent?: AgentHandlerHints }): boolean {
  return screen.agent?.expose !== false;
}
