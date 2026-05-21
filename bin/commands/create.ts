import { parseArgs, getStringFlag } from "./arg-parser";
import { defineCommand } from "./registry";

export const createCommand = defineCommand({
  id: "create",
  label: "create",
  description: "Scaffold an empty feature workspace",
  help: "Usage: kumiko create <camelCaseName> [--path <dir>]\n\n<name> is required, camelCase-validated.\n--path overrides destination, default samples/recipes/<kebab-name>/",
  category: "code",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    const args = parseArgs(ctx.argv);
    const name = args.positional[0];
    if (!name) {
      ctx.out.err("");
      ctx.out.err("  Usage: kumiko create <camelCaseName> [--path <dir>]");
      ctx.out.err("");
      return 1;
    }
    const destination = getStringFlag(args, "path");
    const { scaffoldFeature } = await import("@cosmicdrift/kumiko-dev-server");
    try {
      const result = scaffoldFeature({
        name,
        ...(destination !== undefined && { destination }),
      });
      const relDest = result.destination.startsWith(ctx.cwd)
        ? result.destination.slice(ctx.cwd.length + 1)
        : result.destination;
      ctx.out.log("");
      ctx.out.log(`  ✓ Feature scaffolded — ${result.featureName}`);
      ctx.out.log(`    package: ${result.packageName}`);
      ctx.out.log(`    path:    ${relDest}`);
      ctx.out.log("");
      ctx.out.log("  Next: run yarn install, then edit src/feature.ts.");
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
