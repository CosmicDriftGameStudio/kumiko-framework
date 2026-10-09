#!/usr/bin/env bun
// Same bin as @cosmicdrift/kumiko-dev-server's kumiko-upgrade. Repos that only
// depend on kumiko-cli + kumiko-guards never get a transitive dependency's bin
// linked, and guard-upgrade-state needs it in node_modules/.bin.

import { missingPeerMessage } from "../src/missing-peer";

// biome-ignore lint/suspicious/noConsole: CLI output is the feature.
const out = { log: (l: string) => console.log(l), err: (l: string) => console.error(l) };
const appCwd = process.env["INIT_CWD"] ?? process.cwd();

try {
  const { runUpgradeCli } = await import("@cosmicdrift/kumiko-framework/upgrade-cli");
  // Let the event loop drain stdout (piped by guard-upgrade-state) before exit.
  process.exitCode = await runUpgradeCli(process.argv.slice(2), appCwd, out);
} catch (error) {
  const message = missingPeerMessage(error);
  if (message === undefined) throw error;
  out.err(message);
  process.exitCode = 1;
}
