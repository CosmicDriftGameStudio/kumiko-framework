---
"@cosmicdrift/kumiko-cli": patch
---

kumiko-cli declares @cosmicdrift/kumiko-framework and @cosmicdrift/kumiko-bundled-features as optional peer dependencies instead of hard dependencies, so `kumiko new app` no longer pulls them in; commands that need them report a missing install instead of a resolver stacktrace
