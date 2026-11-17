// biome-ignore-all lint/suspicious/noConsole: CLI script; console is an intentional feature.
//
// runCli — programmatic entry-point for the kumiko CLI. The bin-shim
// (../bin/cli.ts) is a 3-line wrapper that forwards process.argv. Tests
// drive runCli directly with a captured Output so no subprocess is needed.
//
// Scope: scaffolding (`new app <name>`, `add feature <name>`), the quality
// gate (`check`) and the app-facing ops commands (`agent`, `project`,
// `consumer`). Workspace-only maintainer commands (ci:guards, dev, build, …)
// stay in the framework repo's bin/kumiko.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CliCommand } from "./commands";
import { APP_COMMANDS, findAppCommand } from "./commands";
import type { Output } from "./output";

export type { Output } from "./output";

export type RunCliOptions = {
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly out?: Output;
};

const DEFAULT_OUT: Output = {
  log: (line) => console.log(line),
  err: (line) => console.error(line),
};

function readCliVersion(): string {
  const manifestPath = join(import.meta.dir, "..", "package.json");
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf-8"));
  if (
    typeof manifest === "object" &&
    manifest !== null &&
    "version" in manifest &&
    typeof manifest.version === "string"
  ) {
    return manifest.version;
  }
  throw new Error(`${manifestPath} has no "version"`);
}

export async function runCli(options: RunCliOptions): Promise<number> {
  const out = options.out ?? DEFAULT_OUT;
  const argv = [...options.argv];
  const cwd = options.cwd ?? process.cwd();

  const first = argv[0];
  if (!first || first === "-h" || first === "--help") {
    printHelp(out);
    return 0;
  }
  if (first === "-v" || first === "--version") {
    out.log(readCliVersion());
    return 0;
  }

  if (first === "new") return await runNew(argv.slice(1), out, cwd);
  if (first === "add") return await runAdd(argv.slice(1), out, cwd);

  const appCommand = findAppCommand(first);
  if (appCommand) {
    const rest = argv.slice(1);
    if (rest.includes("--help") || rest.includes("-h")) {
      printCommandHelp(appCommand, out);
      return 0;
    }
    return await appCommand.run({ argv: rest, cwd, out });
  }

  out.err(`kumiko: unknown command "${first}". Run \`kumiko --help\` for usage.`);
  return 1;
}

async function runNew(args: readonly string[], out: Output, cwd: string): Promise<number> {
  const [subject] = args;
  if (subject !== "app") {
    out.err(`kumiko new: only "new app <name>" is supported. Got "${subject ?? "(nothing)"}".`);
    return 1;
  }
  try {
    const { parseArgv, runCreate } = await import("create-kumiko-app");
    const parsed = parseArgv(args.slice(1));
    if (!parsed.name) {
      out.err("kumiko new app: missing <name>. Example: `kumiko new app my-shop`.");
      return 1;
    }
    return await runCreate({ ...parsed, yes: true, cwd, log: (line) => out.log(line) });
  } catch (e) {
    out.err(`kumiko new app: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

async function runAdd(args: readonly string[], out: Output, cwd: string): Promise<number> {
  const [subject, name] = args;
  if (subject !== "feature") {
    out.err(`kumiko add: only "add feature <name>" is supported. Got "${subject ?? "(nothing)"}".`);
    return 1;
  }
  if (!name) {
    out.err("kumiko add feature: missing <name>. Example: `kumiko add feature notes`.");
    return 1;
  }
  try {
    const { scaffoldAppFeature } = await import(
      "@cosmicdrift/kumiko-dev-server/scaffold-app-feature"
    );
    const result = scaffoldAppFeature({ name, appRoot: cwd });
    out.log(`✓ Added feature ${result.featureName}:`);
    for (const f of result.files) out.log(`  ${f}`);
    out.log(
      result.autoMounted
        ? "  src/run-config.ts (auto-mounted)"
        : "  ⚠ src/run-config.ts not auto-mounted — hand-edit APP_FEATURES.",
    );
    return 0;
  } catch (e) {
    out.err(`kumiko add feature: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

function printHelp(out: Output): void {
  out.log(`kumiko v${readCliVersion()} — scaffold Kumiko apps`);
  out.log("");
  out.log("Commands:");
  out.log(
    "  kumiko new app <name>        Scaffold an app with the recommended features (--blank: no demo data)",
  );
  out.log("  kumiko add feature <name>    Add + auto-mount a feature");
  for (const cmd of APP_COMMANDS) {
    out.log(`  kumiko ${cmd.id.padEnd(22)}${cmd.description}`);
  }
  out.log("  kumiko --version             Print version");
  out.log("  kumiko --help                This help");
  out.log("");
  out.log("Docs: https://docs.kumiko.rocks");
}

function printCommandHelp(cmd: CliCommand, out: Output): void {
  out.log("");
  out.log(`  kumiko ${cmd.id} — ${cmd.description}`);
  out.log("");
  for (const line of cmd.help.split("\n")) out.log(`  ${line}`);
  out.log("");
}
