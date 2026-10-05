#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: CLI script, console is the interface.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { BUNFIG_FILES, mergeBunfig, renderBunfigFiles } from "../src/bunfig";
import {
  buildIntegrationTestArgs,
  listIntegrationTestFiles,
  resolveRequestedIntegrationFiles,
  selectIntegrationFiles,
} from "../src/integration-runner";

const USAGE = `kumiko-testing <command>

  bunfig [--dom] [--coverage] [--hoisted]  write bunfig.toml, bunfig.integration.toml and
                                           bunfig.real.toml (plus bunfig.dom.toml with --dom);
                                           --hoisted adds [install] linker = "hoisted"
  integration [--parallel N]               run every *.integration.test.ts under the cwd,
              [--timings <file>] [--update-timings]  or only the given file(s) when passed
              [file...]                               as positional args
  -h, --help                               print this help (also works after a command)
`;

function isHelpFlag(arg: string | undefined): boolean {
  return arg === "--help" || arg === "-h";
}

function runBunfig(args: readonly string[]): number {
  const { values } = parseArgs({
    args: [...args],
    options: {
      dom: { type: "boolean" },
      coverage: { type: "boolean" },
      hoisted: { type: "boolean" },
    },
    strict: true,
  });
  const files = renderBunfigFiles({
    dom: values.dom === true,
    coverage: values.coverage === true,
    ...(values.hoisted === true && { install: { linker: "hoisted" } }),
  });
  let blocked = false;
  for (const [name, content] of Object.entries(files)) {
    let toWrite = content;
    if (existsSync(name)) {
      const merged = mergeBunfig(content, readFileSync(name, "utf-8"));
      if (!merged.ok) {
        const keys = merged.unknownKeys.map((k) => `${k.section}.${k.key}`).join(", ");
        console.error(
          `${name} has key(s) kumiko-testing does not manage: ${keys}. Regenerating would drop them silently — remove them from ${name} or move them out of [install]/[test], then rerun.`,
        );
        blocked = true;
        continue;
      }
      toWrite = merged.content;
    }
    writeFileSync(name, toWrite);
    console.log(`wrote ${name}`);
  }
  return blocked ? 1 : 0;
}

async function runIntegration(args: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: {
      parallel: { type: "string" },
      timings: { type: "string" },
      "update-timings": { type: "boolean" },
    },
    allowPositionals: true,
    strict: true,
  });
  if (!existsSync(BUNFIG_FILES.integration)) {
    console.error(`${BUNFIG_FILES.integration} not found - run \`kumiko-testing bunfig\` first`);
    return 1;
  }
  let files: string[];
  if (positionals.length > 0) {
    try {
      files = resolveRequestedIntegrationFiles(process.cwd(), positionals);
      if (files.length === 0) throw new Error("no *.integration.test.ts files found");
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  } else {
    files = selectIntegrationFiles(listIntegrationTestFiles(process.cwd()));
    if (files.length === 0) {
      console.error("no *.integration.test.ts files found");
      return 1;
    }
  }
  const testArgs = buildIntegrationTestArgs({
    files,
    ...(values.parallel !== undefined && { parallel: Number(values.parallel) }),
    ...(values.timings !== undefined && { timings: values.timings }),
    ...(values["update-timings"] === true && { updateTimings: true }),
  });
  const proc = Bun.spawn(["bun", ...testArgs], { stdio: ["inherit", "inherit", "inherit"] });
  return proc.exited;
}

const [command, ...rest] = process.argv.slice(2);
if (isHelpFlag(command) || rest.some(isHelpFlag)) {
  console.log(USAGE);
  process.exit(0);
}
if (command === "bunfig") process.exit(runBunfig(rest));
if (command === "integration") process.exit(await runIntegration(rest));
console.error(USAGE);
process.exit(2);
