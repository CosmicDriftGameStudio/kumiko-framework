---
"@cosmicdrift/kumiko-framework": patch
---

CLI command registry: add `createCommandRegistry()` and back the free
`defineCommand`/`getCommand`/`getCommands` with a single process-wide default
instance. The registry unit test now exercises a fresh isolated instance
instead of clearing the shared default in `afterEach` (`_resetRegistry`, now
removed) — that clear raced the bin/-command coverage tests that read the
shared registry under the concurrent test runner, intermittently failing CI
with "command \"status\" missing" on unrelated PRs.
