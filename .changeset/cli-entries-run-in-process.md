---
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-feature-ast": patch
---

The `kumiko-testing` bin and the feature-ast codemods now expose a `main(argv)` that returns the exit code, so their logic can run in-process. Command-line behavior and exit codes are unchanged.

<!-- kumiko-changes
feature: tooling
type: improvement
title: CLI entries return their exit code
detail: kumiko-testing and the feature-ast codemods (including runCodemod next to runCodemodCli) return an exit code from main instead of calling process.exit, so tests call them directly instead of spawning a process. Invocation from the shell is unchanged.
-->
