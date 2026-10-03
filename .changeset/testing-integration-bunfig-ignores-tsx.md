---
"@cosmicdrift/kumiko-testing": patch
---

The generated `bunfig.integration.toml` now ignores `**/*.test.tsx`. Calling `bun test --config=bunfig.integration.toml <dir>` directly no longer picks up DOM tests, which failed there without the DOM preload. The runner and `test:dom` collect the same tests as before.

<!-- kumiko-changes
feature: testing
type: fix
title: Generated integration bunfig ignores *.test.tsx
migration: |
  Regenerate with `kumiko-testing bunfig` after the bump to pick up the new ignore pattern.
-->
