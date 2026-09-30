#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: CLI script, console is the feature.
// kumiko-init-deploy — Scaffold deploy/{Dockerfile,Dockerfile.dockerignore,
// migrate-step.sh} from the canonical templates shipped with this package.
//
// Usage:
//   bunx kumiko-init-deploy --app <name> [--port <n>] [--github-org <org>] [--out <dir>] [--force]
//   bunx kumiko-init-deploy --check   # drift check, exit 1 if deploy/ is stale

import { runInitDeployCli } from "../src/init-deploy-cli";

// Only run when executed as a CLI, not when imported (e.g. from tests that
// exercise runInitDeployCli directly).
if (import.meta.main) {
  const exitCode = await runInitDeployCli({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    out: { log: console.log, err: console.error },
  });
  process.exit(exitCode);
}
