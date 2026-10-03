---
"@cosmicdrift/kumiko-bundled-features": patch
---

agent-tools: `get_<entity>` and `list_<entity>` take their risk from the entity handler's `agent.risk` instead of a hard-coded `low`. The SystemAdmin `user:list`, `user:detail` and `download-attempt:list` handlers declare `risk: "high"`.

<!-- kumiko-changes
feature: agent-tools
type: security
title: entity get/list tools honour agent.risk, PII-bearing system lists are high risk
migration: |
  No action needed: handlers without an agent.risk hint stay low risk.
-->
