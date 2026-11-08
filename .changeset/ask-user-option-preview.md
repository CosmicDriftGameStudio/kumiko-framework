---
"@cosmicdrift/kumiko-bundled-features": minor
---

The agent tool `ask_user` accepts options as `string | { label, preview? }`.

<!-- kumiko-changes
feature: agent-tools
type: improvement
title: ask_user options can carry a preview
detail: Each option of the `ask_user` agent tool is a string or `{ label, preview? }`, where `preview` is the text the agent writes if the option is chosen. Plain string options keep working.
-->
