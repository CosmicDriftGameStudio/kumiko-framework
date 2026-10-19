import type { CliCommand, CliCommandContext } from "./types";

// The shipped codemods that share the `<dir...> [--check | --dry-run | --write]` CLI of codemod-support.
const CODEMODS = ["feature-factory", "import-extensions", "package-merge", "s3-imports"] as const;
type CodemodName = (typeof CODEMODS)[number];

function isCodemodName(value: string | undefined): value is CodemodName {
  return CODEMODS.some((known) => known === value);
}

const MODE_FLAGS = ["--write", "--check", "--dry-run"] as const;

function printList(ctx: CliCommandContext): void {
  ctx.out.log("");
  ctx.out.log("  Codemods (kumiko codemod <name> [dir...] [--write | --check]):");
  for (const name of CODEMODS) ctx.out.log(`    ${name}`);
  ctx.out.log("");
}

async function runCodemod(ctx: CliCommandContext): Promise<number> {
  const name = ctx.argv[0];
  if (name === undefined) {
    printList(ctx);
    return 0;
  }
  if (!isCodemodName(name)) {
    ctx.out.err(`  unknown codemod "${name}".`);
    printList(ctx);
    return 1;
  }

  const rest = ctx.argv.slice(1);
  const dirs = rest.filter((arg) => !arg.startsWith("--"));
  const flags = rest.filter((arg) => arg.startsWith("--"));
  // Unlike the bare script, which writes without a flag, the command previews unless asked.
  const modeFlags = flags.some((flag) => MODE_FLAGS.some((mode) => mode === flag))
    ? flags
    : [...flags, "--dry-run"];

  const { resolveCodemodScript } = await import("@cosmicdrift/kumiko-framework/upgrade-cli");
  const scriptField = `scripts/codemod/${name}.ts`;
  // The project's own install wins; the framework next to this CLI is the fallback.
  const script =
    resolveCodemodScript(ctx.cwd, scriptField) ??
    resolveCodemodScript(import.meta.dir, scriptField);
  if (script === null) {
    ctx.out.err(
      "  Codemod script not found. Install @cosmicdrift/kumiko-framework in this project.",
    );
    return 1;
  }

  const proc = Bun.spawn({
    cmd: ["bun", script, ...(dirs.length > 0 ? dirs : ["."]), ...modeFlags],
    cwd: ctx.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  for (const line of stdout.split("\n").filter((l) => l !== "")) ctx.out.log(line);
  for (const line of stderr.split("\n").filter((l) => l !== "")) ctx.out.err(line);
  return exitCode;
}

export const codemodCommand: CliCommand = {
  id: "codemod",
  description: "Run a framework codemod over your sources (preview unless --write)",
  help: [
    "Usage: kumiko codemod [name] [dir...] [--write | --check]",
    "",
    "Without a name, lists the codemods. With a name, runs it over each dir (default: cwd).",
    "Previews by default; --write rewrites the files, --check exits 1 while sites are left.",
    "`kumiko-upgrade --apply` runs the codemods a release requires; use this one for the rest.",
  ].join("\n"),
  run: runCodemod,
};
