---
"@cosmicdrift/kumiko-guards": patch
---

agent-docs-drift flags AGENTS.md references into docs/, which the framework npm package does not ship.

<!-- kumiko-changes
feature: guards
type: improvement
title: agent-docs-drift rejects docs/ links in AGENTS.md
detail: packages/framework/AGENTS.md is read by agents inside apps, where only the npm package exists. A backticked docs/... reference there now fails the agent-docs-drift guard; link a generated agents/ file or state the fact inline. AGENTS.md also gains the rule that entity tables are rebuilt from events and that data without events belongs in r.storeTable.
-->
