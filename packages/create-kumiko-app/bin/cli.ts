#!/usr/bin/env bun
import { ExitPromptError } from "@inquirer/core";
import { parseArgv, runCreate } from "../src/index";

try {
  process.exit(await runCreate(parseArgv(process.argv.slice(2))));
} catch (err) {
  // Ctrl-C during an Inquirer picker throws this — a clean exit, not a crash.
  if (err instanceof ExitPromptError) process.exit(0);
  throw err;
}
