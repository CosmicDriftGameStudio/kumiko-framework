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
