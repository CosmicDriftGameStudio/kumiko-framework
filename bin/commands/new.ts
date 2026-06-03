import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs, getStringFlag } from "./arg-parser";
import { defineCommand } from "./registry";

const DEV_SERVER_PACKAGE = "@cosmicdrift/kumiko-dev-server";

// Pin scaffolded @cosmicdrift/* deps to the running dev-server's `^x.y.z`
// instead of the "*" default, which yields unreproducible installs.
function resolveFrameworkVersion(): string | undefined {
  const entry = Bun.resolveSync(DEV_SERVER_PACKAGE, import.meta.dir);
  let dir = dirname(entry);
  while (true) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, "utf-8")) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === DEV_SERVER_PACKAGE && pkg.version) return `^${pkg.version}`;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

// kumiko new app <name> — DX-1.0. Scaffolds a fresh runnable Kumiko-app
// workspace. Sister to `kumiko create <feature>` (single feature in
// samples/recipes/) — but here we make a TOP-LEVEL standalone app with
// run-config + bin/main.ts so a new dev gets "boots cleanly" in 3
// commands: `kumiko new app foo && cd foo && bun install && bun run boot`.
//
// Sub-commands:
//   kumiko new app <kebab-name>   — scaffold the app skeleton
//   (kumiko new feature → siehe `kumiko create` für jetzt; DX-2 wird das vereinheitlichen)

export const newCommand = defineCommand({
  id: "new",
  label: "new",
  description: "Scaffold a new Kumiko app or feature (`kumiko new app <name>`)",
  help: [
    "Usage: kumiko new <subject> <name> [--dest <dir>]",
    "",
    "Subjects:",
    "  app <kebab-name>   Scaffold a runnable app workspace (run-config + bin/main + tsconfig)",
    "",
    "Examples:",
    "  kumiko new app my-shop",
    "  kumiko new app my-shop --dest ./apps/my-shop",
  ].join("\n"),
  category: "code",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    const args = parseArgs(ctx.argv);
    const subject = args.positional[0];
    const name = args.positional[1];

    if (subject !== "app") {
      ctx.out.err("");
      ctx.out.err(`  Usage: kumiko new app <kebab-name>`);
      ctx.out.err(`  (only 'app' is supported in DX-1.0)`);
      ctx.out.err("");
      return 1;
    }
    if (!name) {
      ctx.out.err("");
      ctx.out.err("  Missing app name. Usage: kumiko new app <kebab-name>");
      ctx.out.err("");
      return 1;
    }
    const destination = getStringFlag(args, "dest");
    const frameworkVersion = resolveFrameworkVersion();
    const { scaffoldApp } = await import("@cosmicdrift/kumiko-dev-server");
    try {
      const result = scaffoldApp({
        name,
        ...(destination !== undefined && { destination }),
        ...(frameworkVersion !== undefined && { frameworkVersion }),
      });
      const relDest = result.destination.startsWith(ctx.cwd)
        ? result.destination.slice(ctx.cwd.length + 1)
        : result.destination;
      ctx.out.log("");
      ctx.out.log(`  ✓ App scaffolded — ${result.appName}`);
      ctx.out.log(`    path:  ${relDest}`);
      ctx.out.log(`    files: ${result.files.length}`);
      ctx.out.log("");
      ctx.out.log(`  Next:`);
      ctx.out.log(`    cd ${relDest}`);
      ctx.out.log(`    bun install`);
      ctx.out.log(`    cp .env.example .env  # edit JWT_SECRET + KUMIKO_SECRETS_MASTER_KEY_V1`);
      ctx.out.log(`    bun run boot`);
      ctx.out.log("");
      return 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.out.err("");
      ctx.out.err(`  ${msg}`);
      ctx.out.err("");
      return 1;
    }
  },
});
