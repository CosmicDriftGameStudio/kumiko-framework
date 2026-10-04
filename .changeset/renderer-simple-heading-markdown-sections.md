---
"@cosmicdrift/kumiko-bundled-features": minor
---

`createSimpleRenderer` accepts two more section kinds: `{ heading: string }` (rendered as an escaped `<h2>`) and `{ markdown: string }` (rendered with the hardened Markdown renderer; raw HTML is escaped and unsafe link targets are replaced by `#`). Existing section kinds render as before.

<!-- kumiko-changes
feature: renderer-simple
type: improvement
title: Heading and Markdown sections in the simple mail renderer
-->
