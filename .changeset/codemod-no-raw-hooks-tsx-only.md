---
"@cosmicdrift/kumiko-feature-ast": patch
---

The `lint-ignore-to-biome` codemod leaves `no-raw-hooks` markers outside the plugin's scope alone.

<!-- kumiko-changes
feature: feature-ast
type: fix
title: lint-ignore-to-biome skips no-raw-hooks markers outside the plugin scope
detail: The no-raw-hooks Biome plugin only scans .tsx files under web/ and public/, without tests, renderer, document-designer and samples. Converting a marker elsewhere produced a `biome-ignore` that suppresses nothing. The codemod now keeps such markers as they are.
-->
