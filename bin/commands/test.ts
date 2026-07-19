import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { INTEGRATION_RUNNER } from "../_lib/integration-test";
import { runStreaming } from "./_spawn";
import { defineCommand } from "./registry";

export const testCommand = defineCommand({
  id: "test",
  label: "test",
  description: "Run tests (test | integration | e2e | all | <path>)",
  help: "Bun test runner with scope shortcuts:\n  test         Unit tests (integration excluded via bunfig.toml)\n  integration  scripts/run-integration-tests.ts (docker required)\n  e2e          Playwright per package/sample with playwright.config.ts\n  all          Unit + integration\n  <path>       bun test with a path filter\n  --verbose/-v  Skip --dots (full per-test output) — works with any scope",
  category: "quality",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    const verbose = ctx.argv.includes("--verbose") || ctx.argv.includes("-v");
    const args = ctx.argv.filter((a) => a !== "--verbose" && a !== "-v");
    const testFlags = verbose ? [] : ["--dots"];
    const scope = args[0];
    if (scope === "all") {
      ctx.out.log("Full broadside — unit + integration...");
      ctx.out.log("");
      const unit = await runStreaming("bun", ["test", ...testFlags], ctx.out, { cwd: ctx.cwd });
      if (unit !== 0) return unit;
      return await runStreaming("bun", [INTEGRATION_RUNNER], ctx.out, { cwd: ctx.cwd });
    }
    if (scope === "integration") {
      ctx.out.log("Integration tests (docker must be running)...");
      ctx.out.log("");
      return await runStreaming("bun", [INTEGRATION_RUNNER], ctx.out, { cwd: ctx.cwd });
    }
    if (scope === "e2e") {
      const targets: Array<{ root: string; name: string }> = [];
      for (const root of ["packages", "samples/apps", "samples/showcases"]) {
        const rootPath = join(ctx.cwd, root);
        if (!existsSync(rootPath)) continue;
        const entries = await readdir(rootPath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (existsSync(join(rootPath, entry.name, "playwright.config.ts"))) {
            targets.push({ root, name: entry.name });
          }
        }
      }
      if (targets.length === 0) {
        ctx.out.log("No E2E configs found.");
        return 0;
      }
      const labels = targets.map((t) => `${t.root}/${t.name}`).join(", ");
      ctx.out.log(`E2E via Playwright — ${targets.length} target(s): ${labels}`);
      ctx.out.log("");
      let lastCode = 0;
      for (const target of targets) {
        ctx.out.log("");
        ctx.out.log(`=== ${target.root}/${target.name} ===`);
        const targetCwd = join(ctx.cwd, target.root, target.name);
        // Resolved per-target (not hardcoded to ctx.cwd/node_modules/.bin) —
        // in the CDGS parent workspace, bun hoists .bin/playwright only to
        // the workspace root, not into each sub-repo's own node_modules.
        const playwrightBin = Bun.resolveSync("@playwright/test/cli.js", targetCwd);
        const code = await runStreaming(playwrightBin, ["test"], ctx.out, {
          cwd: targetCwd,
        });
        if (code !== 0) lastCode = code;
      }
      return lastCode;
    }
    if (scope) {
      return await runStreaming("bun", ["test", ...testFlags, scope], ctx.out, { cwd: ctx.cwd });
    }
    return await runStreaming("bun", ["test", ...testFlags], ctx.out, { cwd: ctx.cwd });
  },
});
