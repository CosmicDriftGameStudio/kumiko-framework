---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-renderer": patch
---

The app-schema JSON-safety check now rejects `NaN`/`Infinity` defaults and guards against self-referencing values. The agent doc lint reports exposed handlers whose input schema cannot be converted to JSON Schema (they were silently left out of the agent manifest). Icon-only list and edit action buttons now also set `title`, so sighted mouse users get the hover tooltip.

<!-- kumiko-changes
feature: framework
type: fix
title: App-schema JSON-safety rejects NaN/Infinity and cyclic defaults
-->

<!-- kumiko-changes
feature: agent-tools
type: fix
title: Agent doc lint reports exposed handlers with a non-convertible input schema
-->

<!-- kumiko-changes
feature: renderer
type: fix
title: Icon-only list and edit action buttons set a hover title
-->
