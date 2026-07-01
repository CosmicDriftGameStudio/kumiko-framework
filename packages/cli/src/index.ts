// biome-ignore-all lint/suspicious/noConsole: CLI-Script, console ist Feature.
//
// runCli — programmatic entry-point for the kumiko CLI. The bin-shim
// (../bin/cli.ts) is a 3-line wrapper that forwards process.argv. Tests
// drive runCli directly with a captured Output so no subprocess is needed.
//
// Scope (DX-1.2 minimum-viable): `new app <name>` + `add feature <name>`.
// Other commands (dev, build, check, …) stay in the in-repo bin/kumiko.ts
// for now — that one operates on the framework workspace, not on a
// user-app workspace.

import { scaffoldApp, scaffoldAppFeature } from "@cosmicdrift/kumiko-dev-server";

export type Output = {
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
};

export type RunCliOptions = {
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly out?: Output;
};

const DEFAULT_OUT: Output = {
  log: (line) => console.log(line),
  // @wrapper-known semantic-alias
  err: (line) => console.error(line),
};

const VERSION = "0.1.0";

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
    out.log(VERSION);
    return 0;
  }

  if (first === "new") return await runNew(argv.slice(1), out, cwd);
  if (first === "add") return runAdd(argv.slice(1), out, cwd);

  out.err(`kumiko: unknown command "${first}". Run \`kumiko --help\` for usage.`);
  return 1;
}

async function runNew(args: readonly string[], out: Output, cwd: string): Promise<number> {
  const [subject, name] = args;
  if (subject !== "app") {
    out.err(`kumiko new: only "new app <name>" is supported. Got "${subject ?? "(nothing)"}".`);
    return 1;
  }
  if (!name) {
    out.err("kumiko new app: missing <name>. Example: `kumiko new app my-shop`.");
    return 1;
  }
  try {
    const result = await scaffoldApp({ name, destination: `${cwd}/${name}` });
    out.log(`✓ Scaffolded ${result.appName} → ${result.destination}`);
    out.log("");
    for (const f of result.files) out.log(`  ${f}`);
    out.log("");
    out.log("Next:");
    out.log(`  cd ${name}`);
    out.log("  bun install && cp .env.example .env");
    out.log("  bun run boot");
    return 0;
  } catch (e) {
    out.err(`kumiko new app: ${(e as Error).message}`);
    return 1;
  }
}

function runAdd(args: readonly string[], out: Output, cwd: string): number {
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
    out.err(`kumiko add feature: ${(e as Error).message}`);
    return 1;
  }
}

function printHelp(out: Output): void {
  out.log(`kumiko v${VERSION} — scaffold Kumiko apps`);
  out.log("");
  out.log("Commands:");
  out.log("  kumiko new app <name>        Scaffold a new app workspace");
  out.log("  kumiko add feature <name>    Add + auto-mount a feature");
  out.log("  kumiko --version             Print version");
  out.log("  kumiko --help                This help");
  out.log("");
  out.log("Docs: https://docs.kumiko.rocks");
}
