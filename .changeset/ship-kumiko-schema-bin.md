---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-dev-server": minor
---

migrations: ship an app-facing `kumiko-schema` CLI bin.

Apps could not run the drizzle-free migration commands: the `kumiko schema`
subcommands live in the dev CLI, whose registry eager-loads ts-morph-heavy dev
commands and isn't shipped to apps. This extracts the generate/apply/baseline/
status core into `@cosmicdrift/kumiko-framework/schema-cli` (`runSchemaCli`) and
ships a self-contained `kumiko-schema` bin from `@cosmicdrift/kumiko-dev-server`:

    bunx kumiko-schema generate <name>
    bunx kumiko-schema apply
    bunx kumiko-schema baseline   # adopt an existing DB (tables already exist)
    bunx kumiko-schema status

The dev `kumiko schema` command now delegates to the same core — one
implementation, no drift.
