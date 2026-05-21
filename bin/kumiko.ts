#!/usr/bin/env bun
// kumiko CLI bootstrap. Loads the command-registry (side-effect imports
// in bin/commands/index.ts), detects the role, dispatches the requested
// command. No-args + TTY launches the Ink-TUI.
//
// The legacy 1600-LOC monolith lives in bin/kumiko-legacy.ts — the
// check / check:fast / ci:guards commands still subprocess-delegate
// there because their 300-LOC parallel-lock + tee-logging machinery
// hasn't been extracted yet (Sprint C).

import { existsSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { getCommand, getCommands } from "./commands";
import { detectRole } from "./role";
import type { CommandContext, Output, Role } from "./commands/types";

const CONSOLE_OUTPUT: Output = {
  log: (m: string) => console.log(m),
  warn: (m: string) => console.warn(m),
  err: (m: string) => console.error(m),
};

function findRepoRoot(): string {
  // bin/kumiko.ts lebt in framework-Repo-Root. import.meta.dir = bin/,
  // also ".." = framework-Root. KUMIKO_REPO_ROOT-Override für bundled-
  // scenarios.
  return process.env["KUMIKO_REPO_ROOT"] ?? resolvePath(import.meta.dir, "..");
}

function findBinPath(repoRoot: string, cwd: string): string {
  const rootBin = join(repoRoot, "node_modules", ".bin");
  if (existsSync(rootBin)) return rootBin;
  const localBin = join(cwd, "node_modules", ".bin");
  if (existsSync(localBin)) return localBin;
  return rootBin;
}

async function main(): Promise<number> {
  const fullArgv = process.argv.slice(2);
  const commandName = fullArgv[0];

  // No args + TTY → Ink-TUI. Headless / piped → help.
  if (!commandName) {
    if (process.stdout.isTTY) {
      try {
        const { runTui } = await import("./kumiko-tui/index.tsx");
        await runTui();
        return 0;
      } catch (e) {
        console.warn(
          `Ink-TUI nicht verfügbar (${e instanceof Error ? e.message : "?"}), zeige Help.\n`,
        );
      }
    }
    printHelp(detectRole(process.cwd(), fullArgv));
    return 0;
  }

  if (commandName === "help" || commandName === "--help") {
    printHelp(detectRole(process.cwd(), fullArgv));
    return 0;
  }

  // Strip the command-name + any --as <role> from the argv we pass
  // downstream to the command.
  const cwd = process.cwd();
  const role: Role = detectRole(cwd, fullArgv);
  const remainingArgv = stripAsOverride(fullArgv.slice(1));

  const cmd = getCommand(commandName);
  if (!cmd) {
    console.error(`\n  I don't know "${commandName}". Maybe a typo? Try: kumiko help\n`);
    return 1;
  }
  if (!cmd.roles.includes(role)) {
    console.error(
      `\n  Command "${commandName}" is not available for role "${role}".\n` +
        `  Override with: kumiko ${commandName} --as ${cmd.roles[0]}\n`,
    );
    return 1;
  }

  const repoRoot = findRepoRoot();
  const ctx: CommandContext = {
    argv: remainingArgv,
    cwd,
    role,
    binPath: findBinPath(repoRoot, cwd),
    repoRoot,
    scope: process.env["KUMIKO_CLI_SCOPE"],
    out: CONSOLE_OUTPUT,
  };

  try {
    return await cmd.run(ctx);
  } catch (e) {
    console.error(`\n  ✗ ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
}

function stripAsOverride(argv: ReadonlyArray<string>): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--as") {
      i++; // skip value
      continue;
    }
    out.push(argv[i]!);
  }
  return out;
}

function printHelp(role: Role): void {
  console.log("");
  console.log(`  kumiko — role: ${role}`);
  console.log("");
  const cmds = getCommands(role);
  for (const cmd of cmds) {
    console.log(`  ${cmd.id.padEnd(18)} ${cmd.description}`);
  }
  console.log("");
}

const exitCode = await main();
if (exitCode !== 0) process.exit(exitCode);
