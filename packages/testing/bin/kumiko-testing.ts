#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { BUNFIG_FILES, mergeBunfig, renderBunfigFiles } from "../src/bunfig";
import {
  buildIntegrationTestArgs,
  listIntegrationTestFiles,
  resolveRequestedIntegrationFiles,
  runWithTestDbTemplates,
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

export type CliIo = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  cwd: string;
};

const processIo: CliIo = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  cwd: process.cwd(),
};

function isHelpFlag(arg: string | undefined): boolean {
  return arg === "--help" || arg === "-h";
}

function runBunfig(args: readonly string[], io: CliIo): number {
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
    const path = join(io.cwd, name);
    let toWrite = content;
    if (existsSync(path)) {
      const merged = mergeBunfig(content, readFileSync(path, "utf-8"));
      if (!merged.ok) {
        const keys = merged.unknownKeys.map((k) => `${k.section}.${k.key}`).join(", ");
        io.stderr(
          `${name} has key(s) kumiko-testing does not manage: ${keys}. Regenerating would drop them silently — remove them from ${name} or move them out of [install]/[test], then rerun.`,
        );
        blocked = true;
        continue;
      }
      toWrite = merged.content;
    }
    writeFileSync(path, toWrite);
    io.stdout(`wrote ${name}`);
  }
  return blocked ? 1 : 0;
}

async function runIntegration(args: readonly string[], io: CliIo): Promise<number> {
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
  if (!existsSync(join(io.cwd, BUNFIG_FILES.integration))) {
    io.stderr(`${BUNFIG_FILES.integration} not found - run \`kumiko-testing bunfig\` first`);
    return 1;
  }
  let files: string[];
  if (positionals.length > 0) {
    try {
      files = resolveRequestedIntegrationFiles(io.cwd, positionals);
      if (files.length === 0) throw new Error("no *.integration.test.ts files found");
    } catch (error) {
      io.stderr(error instanceof Error ? error.message : String(error));
      return 1;
    }
  } else {
    files = selectIntegrationFiles(listIntegrationTestFiles(io.cwd));
    if (files.length === 0) {
      io.stderr("no *.integration.test.ts files found");
      return 1;
    }
  }
  const testArgs = buildIntegrationTestArgs({
    files,
    ...(values.parallel !== undefined && { parallel: Number(values.parallel) }),
    ...(values.timings !== undefined && { timings: values.timings }),
    ...(values["update-timings"] === true && { updateTimings: true }),
  });
  return runWithTestDbTemplates(
    // Bun.spawn defaults to the env from process start; pass the live one so the
    // template run id set by runWithTestDbTemplates reaches the test process.
    () =>
      Bun.spawn(["bun", ...testArgs], {
        cwd: io.cwd,
        stdio: ["inherit", "inherit", "inherit"],
        env: process.env,
      }).exited,
  );
}

export async function main(argv: readonly string[], io: CliIo = processIo): Promise<number> {
  const [command, ...rest] = argv;
  if (isHelpFlag(command) || rest.some(isHelpFlag)) {
    io.stdout(USAGE);
    return 0;
  }
  if (command === "bunfig") return runBunfig(rest, io);
  if (command === "integration") return runIntegration(rest, io);
  io.stderr(USAGE);
  return 2;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
