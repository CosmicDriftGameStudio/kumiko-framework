---
"@cosmicdrift/kumiko-bundled-features": patch
---

`@types/mailparser` moved from `devDependencies` to `dependencies` — it was only a devDependency despite `mailparser` itself being a runtime dependency, so standalone consumers of the IMAP provider hit `tsc` type errors that stayed invisible in the monorepo (types get hoisted there).
