import type { AgentHandlerHints } from "@cosmicdrift/kumiko-types/handlers";
import { AGENT_EFFECT_RULES } from "./agent-effect-rules.ts";
import { bootRuleError } from "./boot-rule.ts";

// effect "proposal" lets the agent run the write without an approval card, which is only safe when
// the result is itself a suggestion a person still approves and the handler is declared low risk.
export function validateAgentProposalEffect(
  featureName: string,
  kind: "write" | "query",
  handlerName: string,
  agent: AgentHandlerHints | undefined,
): void {
  // skip: handler declares no agent effect
  if (agent?.effect === undefined) return;
  const where = `${kind} handler "${featureName}:${kind}:${handlerName}" declares agent.effect "${agent.effect}"`;
  if (kind === "query") {
    throw bootRuleError(AGENT_EFFECT_RULES.effectOnWriteOnly, {
      message: `${where}, but only write handlers have an effect — drop it.`,
    });
  }
  if (agent.risk !== "low") {
    throw bootRuleError(AGENT_EFFECT_RULES.proposalNeedsLowRisk, {
      message: `${where} with agent.risk "${agent.risk ?? "mid (default)"}" — a proposal write skips the approval step, so it must declare risk: "low".`,
    });
  }
}
