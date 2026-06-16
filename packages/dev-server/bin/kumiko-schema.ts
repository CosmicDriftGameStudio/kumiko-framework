#!/usr/bin/env bun
// Shipped, app-facing schema-migration CLI: `kumiko-schema generate|apply|baseline|status`.
//
// Self-contained — delegates to the framework's runSchemaCli core, so apps run
// migrations without the full dev `kumiko` CLI (which eager-loads ts-morph-heavy
// dev commands not shipped to apps). Run from the app workspace root:
//
//   bunx kumiko-schema generate init
//   bunx kumiko-schema apply
//   bunx kumiko-schema baseline   # adopt an existing DB (tables already exist)
//   bunx kumiko-schema status

import { runSchemaCli } from "@cosmicdrift/kumiko-framework/schema-cli";

// biome-ignore lint/suspicious/noConsole: CLI output is the feature.
const out = { log: (l: string) => console.log(l), err: (l: string) => console.error(l) };
const appCwd = process.env["INIT_CWD"] ?? process.cwd();
const code = await runSchemaCli(process.argv.slice(2), appCwd, out);
process.exit(code);
