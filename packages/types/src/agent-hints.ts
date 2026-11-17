export type AgentRisk = "low" | "mid" | "high";

/** "proposal": the write only changes a suggestion that a person still approves elsewhere, so the
 *  agent may run it without its own approval step. Boot accepts it only with `risk: "low"`.
 *  "outbound": the write sends something out of the system (mail, message) that cannot be
 *  recalled, so every call needs its own approval and no standing approval ever covers it. */
export type AgentEffect = "proposal" | "outbound";

/** Per-handler hints for the AI-agent manifest. `expose` overrides the
 *  default derived from `description`; `risk` overrides the per-kind default. */
export type AgentHandlerHints = {
  readonly expose?: boolean;
  readonly risk?: AgentRisk;
  readonly effect?: AgentEffect;
};

/** Screens only read `expose`; `risk` ranks handler tool calls, so it is not offered here. */
export type AgentScreenHints = Pick<AgentHandlerHints, "expose">;

export type AgentExposure = {
  readonly expose: boolean;
  readonly risk: AgentRisk;
  readonly effect?: AgentEffect;
};
