---
"@cosmicdrift/kumiko-guards": patch
---

The cross-feature import guard also checks re-exports.

<!-- kumiko-changes
feature: guards
type: fix
title: Cross-feature import guard checks re-exports
detail: `export { x } from "../other-feature/internal"` and `export * from "../other-feature/internal"` count like an import: a re-export of another feature's internals is a violation, while the barrel, `contract`, `schema/entity` and `web` stay allowed and `// kumiko-lint-ignore cross-feature-import <reason>` on the line or the line above suppresses it. Dynamic `import()` stays unchecked.
-->
