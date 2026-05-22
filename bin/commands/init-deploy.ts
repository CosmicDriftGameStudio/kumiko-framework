import type { ScaffoldedFile } from "@cosmicdrift/kumiko-dev-server";
import { getNumberFlag, getStringFlag, parseArgs } from "./arg-parser";
import { defineCommand } from "./registry";

export const initDeployCommand = defineCommand({
  id: "init-deploy",
  label: "init-deploy",
  description: "Scaffold deploy/{Dockerfile,Dockerfile.dockerignore,migrate-step.sh}",
  help: [
    "Usage: kumiko init-deploy --app <name> [--port <n>] [--github-org <org>] [--out <dir>] [--force]",
    "",
    "Substitutes {{appName}}, {{port}}, {{githubOrg}} into the canonical",
    "deploy templates shipped with @cosmicdrift/kumiko-dev-server.",
    "",
    "Refuses to overwrite existing files unless --force is set — guards",
    "against clobbering a tuned Dockerfile.",
  ].join("\n"),
  category: "code",
  roles: ["app-dev"],
  run: async (ctx) => {
    const args = parseArgs(ctx.argv);
    const appName = getStringFlag(args, "app");
    if (!appName) {
      ctx.out.err("");
      ctx.out.err("  Usage: kumiko init-deploy --app <name> [--port <n>] [--github-org <org>] [--out <dir>] [--force]");
      ctx.out.err("");
      return 1;
    }
    const port = getNumberFlag(args, "port");
    const githubOrg = getStringFlag(args, "github-org");
    const destination = getStringFlag(args, "out");
    const force = args.flags.has("force");

    const { scaffoldDeploy } = await import("@cosmicdrift/kumiko-dev-server");
    try {
      const result = scaffoldDeploy({
        appName,
        ...(port !== undefined && { port }),
        ...(githubOrg !== undefined && { githubOrg }),
        ...(destination !== undefined && { destination }),
        force,
      });
      ctx.out.log("");
      ctx.out.log(`  ✓ Deploy scaffolding generated — ${appName}`);
      for (const f of result.files as readonly ScaffoldedFile[]) {
        const rel = f.path.startsWith(ctx.cwd) ? f.path.slice(ctx.cwd.length + 1) : f.path;
        const marker = f.written
          ? f.reason === "force"
            ? "OVERWRITTEN"
            : "WRITTEN    "
          : "SKIPPED    ";
        ctx.out.log(`    ${marker} ${rel}`);
      }
      if (result.files.some((f) => !f.written)) {
        ctx.out.log("");
        ctx.out.log("  Some files were skipped because they already exist. Re-run with --force to overwrite.");
      }
      ctx.out.log("");
      ctx.out.log("  Next steps:");
      ctx.out.log("    1. Review deploy/Dockerfile — adjust if your app needs extra COPY/ENV steps.");
      ctx.out.log("    2. Wire .github/workflows/build-image.yml to build deploy/Dockerfile + push to ghcr.io.");
      ctx.out.log("    3. Configure the runtime env-vars (see `KUMIKO_DRY_RUN_ENV=pulumi bun bin/main.ts`).");
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
