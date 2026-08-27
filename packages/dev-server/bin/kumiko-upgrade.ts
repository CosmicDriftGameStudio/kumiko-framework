#!/usr/bin/env bun
// Shipped, app-facing upgrade CLI: `kumiko-upgrade [--from <version>] [--json] [--verbose]`.
//
// Self-contained — delegates to the framework's runUpgradeCli core, so apps
// check for breaking changes without the full dev `kumiko` CLI. Run from the
// app workspace root:
//
//   bunx kumiko-upgrade
//   bunx kumiko-upgrade --from 0.160.0 --verbose
//   bunx kumiko-upgrade --apply --dry-run

import { runUpgradeCli } from "@cosmicdrift/kumiko-framework/upgrade-cli";

// biome-ignore lint/suspicious/noConsole: CLI output is the feature.
const out = { log: (l: string) => console.log(l), err: (l: string) => console.error(l) };
const appCwd = process.env["INIT_CWD"] ?? process.cwd();
const code = await runUpgradeCli(process.argv.slice(2), appCwd, out);
// Let the event loop drain stdout (piped by guard-upgrade-state) before exit.
process.exitCode = code;
