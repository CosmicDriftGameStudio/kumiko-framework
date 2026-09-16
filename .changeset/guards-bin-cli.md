---
"@cosmicdrift/kumiko-guards": minor
---

`bunx @cosmicdrift/kumiko-guards` is now runnable: a new `src/cli.ts` entry runs all three suites (guards, UI guards, repo checks) in one process and exits 1 if any of them reports a violation, or runs a single suite via `kumiko-guards guards|ui|checks`. `package.json`'s `bin` field now points at this new entry instead of `run-guards.ts` alone, so a plain `bunx`/`kumiko-guards` call covers every guard, not just the AST-guard suite.

<!-- kumiko-changes
feature: guards
type: improvement
title: Add a consumer CLI entry so bunx @cosmicdrift/kumiko-guards runs all three suites
-->
