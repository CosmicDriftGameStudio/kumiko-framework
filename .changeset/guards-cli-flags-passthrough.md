---
"@cosmicdrift/kumiko-guards": patch
---

`kumiko-guards guards` now accepts `--explain`, `--write-security-baseline`, and `--strict-security-baseline`

The `kumiko-guards` bin's `guards` subcommand only ran `process.argv[2]` for the subcommand name and never passed the rest of `argv` into the suite it dispatched to, so `--write-security-baseline` and the other run-guards.ts flags were silently ignored when invoked through the published bin — the only way to reach them was a direct `node_modules/@cosmicdrift/kumiko-guards/src/run-guards.ts` file-path call. Each suite's flag handling now lives in one `run*Cli(argv)` function shared by the bin and the suite's own direct-invocation block, and an unknown flag for any subcommand fails with the flags that subcommand actually understands instead of being ignored.

<!-- kumiko-changes
feature: guards
type: fix
title: kumiko-guards bin now passes flags through to the guards, ui, and checks subcommands
detail: The bin's `guards` subcommand called run-guards.ts's suite runner directly, skipping the `--explain`/`--write-security-baseline`/`--strict-security-baseline` handling that only existed in run-guards.ts's own `if (import.meta.main)` block — a consumer running `bunx @cosmicdrift/kumiko-guards guards --write-security-baseline` got a normal guard run with the flag silently dropped. Each suite (guards, ui, checks) now exports a `run*Cli(argv)` function that validates argv against that suite's known flags and applies them; both the bin and the suite's own direct-invocation entry point call the same function, so they cannot drift apart again. An unknown flag for any subcommand now exits 1 with the flags that subcommand accepts, rather than passing through unnoticed.
-->
