import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { runStreaming } from "./_spawn";
import { defineCommand } from "./registry";

export const testCommand = defineCommand({
  id: "test",
  label: "test",
  description: "Tests laufen lassen (test | integration | e2e | all | <path>)",
  help: "Vitest-Runner mit scope-shortcuts:\n  test         Unit-Tests\n  integration  vitest.integration.config.ts (Docker erforderlich)\n  e2e          Playwright pro package/sample mit playwright.config.ts\n  all          Unit + Integration\n  <path>       Vitest mit Pfad-Filter",
  category: "quality",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    const scope = ctx.argv[0];
    if (scope === "all") {
      ctx.out.log("Volle Breitseite — Unit + Integration...");
      ctx.out.log("");
      const guard = await runStreaming("node", ["vitest.integration.guard.js"], ctx.out, { cwd: ctx.cwd });
      if (guard !== 0) return guard;
      const unit = await runStreaming("yarn", ["vitest", "run"], ctx.out, { cwd: ctx.cwd });
      if (unit !== 0) return unit;
      return await runStreaming("yarn", ["vitest", "run", "--config", "vitest.integration.config.ts"], ctx.out, { cwd: ctx.cwd });
    }
    if (scope === "integration") {
      ctx.out.log("Integration Tests (Docker muss laufen)...");
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
        ctx.out.log("Keine E2E-Configs gefunden.");
        return 0;
      }
      const labels = targets.map((t) => `${t.root}/${t.name}`).join(", ");
      ctx.out.log(`E2E via Playwright — ${targets.length} Target(s): ${labels}`);
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
