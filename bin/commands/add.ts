import { parseArgs } from "./arg-parser";
import { defineCommand } from "./registry";

// kumiko add feature <name> — DX-2. Scaffolds a feature inside the current
// app workspace AND auto-mounts it in src/run-config.ts. Sister to
// `kumiko new app <name>` (DX-1, scaffolds the App itself).
//
// User-promise: "defineFeature → nichts woanders eintragen". Auto-mount
// via ts-morph erfüllt das für die run-config-Seite. (FEATURE_IMPORT_REGISTRY
// in drizzle/generate.ts ist DX-4's Refactor — gibt's bei DX-2 noch nicht
// wenn die App via DX-1 scaffolded wurde.)

export const addCommand = defineCommand({
  id: "add",
  label: "add",
  description: "Add a feature to the current Kumiko app (`kumiko add feature <name>`)",
  help: [
    "Usage: kumiko add <subject> <name>",
    "",
    "Subjects:",
    "  feature <kebab-name>   Scaffold src/features/<name>/ and auto-mount in run-config",
    "",
    "Examples:",
    "  kumiko add feature product-catalog",
    "  kumiko add feature billing",
  ].join("\n"),
  category: "code",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    const args = parseArgs(ctx.argv);
    const subject = args.positional[0];
    const name = args.positional[1];

    if (subject !== "feature") {
      ctx.out.err("");
      ctx.out.err("  Usage: kumiko add feature <kebab-name>");
      ctx.out.err("  (only 'feature' is supported in DX-2.0)");
      ctx.out.err("");
      return 1;
    }
    if (!name) {
      ctx.out.err("");
      ctx.out.err("  Missing feature name. Usage: kumiko add feature <kebab-name>");
      ctx.out.err("");
      return 1;
    }

    const { scaffoldAppFeature } = await import("@cosmicdrift/kumiko-dev-server");
    try {
      const result = scaffoldAppFeature({ name, appRoot: ctx.cwd });
      ctx.out.log("");
      ctx.out.log(`  ✓ Feature scaffolded — ${result.featureName}`);
      ctx.out.log(`    files: ${result.files.length}`);
      for (const f of result.files) {
        ctx.out.log(`      ${f}`);
      }
      if (result.autoMounted) {
        ctx.out.log(`  ✓ Auto-mounted in src/run-config.ts`);
      } else {
        ctx.out.log(`  ! src/run-config.ts not found — hand-edit required.`);
      }
      ctx.out.log("");
      ctx.out.log(`  Next: edit src/features/${name}/feature.ts to declare entities/handlers.`);
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
