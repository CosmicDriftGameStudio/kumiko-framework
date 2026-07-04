---
"@cosmicdrift/kumiko-framework": patch
---

`runSchemaCli` (the standalone schema CLI used by `kumiko-schema` and the
`migrate-db` deploy initContainer) now installs the Temporal polyfill before
running any subcommand. Without it, a projection rebuild triggered by
`schema apply` threw `ReferenceError: Temporal is not defined` on any
runtime lacking native Temporal — deterministically, since `runProdApp`/
`runDevApp` install the polyfill at boot but the standalone CLI never goes
through that boot path. The crash left the triggering migration recorded as
applied with its rebuild never retried, silently emptying the affected
projection tables.
