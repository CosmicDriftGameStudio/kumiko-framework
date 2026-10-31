---
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Write handlers can declare `agent: { risk: "low", effect: "proposal" }` when they only change a suggestion a person still approves; the agent tool descriptor carries the effect.

<!-- kumiko-changes
feature: agent-tools
type: improvement
title: Agent write handlers can be marked as proposal changes
detail: AgentHandlerHints takes effect "proposal" for a write whose result is itself a suggestion that a person approves later (for example a plan step the clerk still checks). resolveAgentExposure, the agent manifest handler entry and the write ToolDispatchDescriptor carry the effect, so an agent runtime can skip its own approval step for these calls. Boot rejects effect "proposal" unless the handler declares risk "low" explicitly (the write default is mid), and rejects any effect on a query handler.
-->
