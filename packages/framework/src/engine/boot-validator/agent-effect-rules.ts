import type { BootRuleTable } from "./boot-rule.ts";

export const AGENT_EFFECT_RULES = {
  effectOnWriteOnly: {
    id: "agent-effect/write-only",
    summary: "Only write handlers declare agent.effect; a query has nothing to approve.",
    fix: "Drop agent.effect from the query handler.",
  },
  proposalNeedsLowRisk: {
    id: "agent-effect/proposal-needs-low-risk",
    summary: 'A write handler with agent.effect "proposal" declares agent.risk "low".',
    fix: 'Set agent.risk to "low", or drop agent.effect so the agent asks for approval.',
  },
} as const satisfies BootRuleTable;
