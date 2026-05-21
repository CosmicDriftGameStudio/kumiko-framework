import { resolve as resolvePath } from "node:path";
import { defineCommand } from "./registry";

export const buildCommand = defineCommand({
  id: "build",
  label: "build",
  description: "Build an app for production (dist/) — takes path or $INIT_CWD",
  help: "Bun.build + Tailwind + public-folder copy. Convention-driven.\n\nUsage: kumiko build [<path>]\nCWD resolution: arg → $INIT_CWD → process.cwd()",
  category: "code",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    const { buildProdBundle, formatBuildResult } = await import(
      "@cosmicdrift/kumiko-dev-server/build"
    );
    const explicit = ctx.argv[0];
    const cwd = explicit
      ? resolvePath(explicit)
      : (process.env["INIT_CWD"] ?? ctx.cwd);
    const t0 = performance.now();
    const result = await buildProdBundle({ cwd });
    const ms = Math.round(performance.now() - t0);
    ctx.out.log(formatBuildResult(result, ms));
    return 0;
  },
});
