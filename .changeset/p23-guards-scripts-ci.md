---
"@cosmicdrift/kumiko-guards": patch
---

The i18n-keys guard reads string literals with `getLiteralText()` so escaped keys match their definitions. The no-framed-extension-sections guard ignores test files when collecting component usages. The renderer-boundaries guard now also rejects a bare `fetch(` call in `packages/renderer/src`, and reports every JSX tag on a line. The `.husky/pre-push` shim only resolves `kumiko-pre-push` from the repo's own `node_modules` or the parent-workspace root, never from arbitrary ancestor directories.

<!-- kumiko-changes
feature: guards
type: fix
title: i18n-keys guard decodes escaped literals, framed-sections guard skips test usages, renderer-boundaries guard blocks bare fetch and reports all JSX tags per line, pre-push shim no longer execs binaries from shared ancestor dirs
-->
