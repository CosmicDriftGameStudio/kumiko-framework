---
"@cosmicdrift/kumiko-testing": patch
"@cosmicdrift/kumiko-feature-ast": patch
---

The `kumiko-testing` bin and the feature-ast codemods now expose a `main(argv)` that returns the exit code, so their logic can run in-process. Command-line behavior and exit codes are unchanged.

<!-- kumiko-changes
feature: feature-ast
type: improvement
title: Codemod entries return their exit code
detail: The feature-ast codemods export main(argv) and runCodemod next to runCodemodCli; they return an exit code instead of calling process.exit, so callers can run them in-process. Invocation from the shell is unchanged.
-->

<!-- kumiko-changes
feature: testing
type: improvement
title: kumiko-testing exports main(argv, io)
detail: The kumiko-testing bin exports main(argv, io), which returns the exit code and writes through the given io, so its commands can run in-process. Invocation from the shell is unchanged.
-->
