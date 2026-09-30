---
"@cosmicdrift/kumiko-testing": patch
---

`kumiko-testing integration <dir>` runs only `*.integration.test.ts` files

A directory argument used to reach `bun test` as a path filter, which also picked up `*.test.tsx` files. It now expands to the integration test files below it.

<!-- kumiko-changes
feature: testing
type: fix
title: kumiko-testing integration with a directory runs only *.integration.test.ts files
-->
