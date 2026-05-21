import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { runStreaming } from "./_spawn";
import { defineCommand } from "./registry";

export const testCommand = defineCommand({
  id: "test",
  label: "test",
  description: "Run tests (test | integration | e2e | all | <path>)",
  help: "Vitest runner with scope shortcuts:\n  test         Unit tests\n  integration  vitest.integration.config.ts (docker required)\n  e2e          Playwright per package/sample with playwright.config.ts\n  all          Unit + integration\n  <path>       Vitest with a path filter",
  category: "quality",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    const scope = ctx.argv[0];
    if (scope === "all") {
      ctx.out.log("Full broadside — unit + integration...");
      ctx.out.log("");
      const guard = await runStreaming("node", ["vitest.integration.guard.js"], ctx.out, { cwd: ctx.cwd });
      if (guard !== 0) return guard;
      const unit = await runStreaming("yarn", ["vitest", "run"], ctx.out, { cwd: ctx.cwd });
      if (unit !== 0) return unit;
      return await runStreaming("yarn", ["vitest", "run", "--config", "vitest.integration.config.ts"], ctx.out, { cwd: ctx.cwd });
    }
    if (scope === "integration") {
      ctx.out.log("Integration tests (docker must be running)...");
      ctx.out.log("");
      const guard = await runStreaming("node", ["vitest.integration.guard.js"], ctx.out, { cwd: ctx.cwd });
      if (guard !== 0) return guard;
      return await runStreaming("yarn", ["vitest", "run", "--config", "vitest.integration.config.ts"], ctx.out, { cwd: ctx.cwd });
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
      const playwrightBin = join(ctx.cwd, "node_modules/.bin/playwright");
      let lastCode = 0;
      for (const target of targets) {
        ctx.out.log("");
        ctx.out.log(`=== ${target.root}/${target.name} ===`);
        const code = await runStreaming(playwrightBin, ["test"], ctx.out, {
          cwd: join(ctx.cwd, target.root, target.name),
        });
        if (code !== 0) lastCode = code;
      }
      return lastCode;
    }
    if (scope) {
      return await runStreaming("yarn", ["vitest", "run", scope], ctx.out, { cwd: ctx.cwd });
    }
    return await runStreaming("yarn", ["vitest", "run"], ctx.out, { cwd: ctx.cwd });
  },
});
