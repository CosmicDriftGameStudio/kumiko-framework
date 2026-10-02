---
"@cosmicdrift/kumiko-testing": patch
---

The scaffolded `test:real` script now filters on `.real.test.ts` instead of `real.test.ts`, so files such as `unreal.test.ts` no longer run under the real-provider environment.

<!-- kumiko-changes
feature: testing
type: fix
title: Scaffolded test:real only matches *.real.test.ts files
-->
