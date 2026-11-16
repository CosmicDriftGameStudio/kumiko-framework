#!/usr/bin/env bun
// guard-upgrade-state runs this bin from node_modules/.bin; kumiko-cli is the only package that ships it.
import { runUpgradeCli } from "@cosmicdrift/kumiko-framework/upgrade-cli";

// biome-ignore lint/suspicious/noConsole: CLI output is the feature.
const out = { log: (l: string) => console.log(l), err: (l: string) => console.error(l) };
const appCwd = process.env["INIT_CWD"] ?? process.cwd();
// Let the event loop drain stdout (piped by guard-upgrade-state) before exit.
process.exitCode = await runUpgradeCli(process.argv.slice(2), appCwd, out, {
  codemodResolveFrom: import.meta.dir,
});
