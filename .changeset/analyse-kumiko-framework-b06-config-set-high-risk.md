---
"@cosmicdrift/kumiko-bundled-features": patch
---

The agent now treats `config:write:set` as high risk, like `config:write:reset`.

<!-- kumiko-changes
feature: config
type: fix
title: Config set needs an approval per agent call
detail: `config:write:set` declares `agent: { risk: "high" }`, so an AI agent asks for approval on every change of a config value and a standing approval no longer covers it.
-->
