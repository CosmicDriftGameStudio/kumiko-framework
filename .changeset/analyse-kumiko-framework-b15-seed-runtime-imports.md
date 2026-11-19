---
"@cosmicdrift/kumiko-guards": minor
---

The new guard `seed-runtime-imports` keeps seeds runnable in the runtime image.

<!-- kumiko-changes
feature: guards
type: breaking
title: seed-runtime-imports guard
detail: In apps, files under `seeds/` may not import `@cosmicdrift/*` at runtime (only `import type`), and relative imports may not leave `seeds/`, because the runtime image ships `seeds/` without `src/` and bundles the framework into server.js. Static imports, re-exports, `import()` and `require()` are checked.
migration: Turn framework imports in seeds into `import type` or inline the value, move shared helpers into `seeds/`, and delete the import tests of app-level copies such as `seed-boot-safety.test.ts`.
affects: all
-->
