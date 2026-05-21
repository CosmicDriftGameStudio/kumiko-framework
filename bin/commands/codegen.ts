import { resolve as resolvePath } from "node:path";
import { defineCommand } from "./registry";

export const codegenCommand = defineCommand({
  id: "codegen",
  label: "codegen",
  description: "App codegen — emit .kumiko/define.ts + types.generated.d.ts from r.defineEvent",
  help: "Reads r.defineEvent calls and writes .kumiko/define.ts + types.generated.d.ts.\nIdempotent. CI-friendly for sync checks.\n\nUsage: kumiko codegen [<path>]\nCWD resolution: arg → $INIT_CWD → process.cwd()",
  category: "code",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    const { runCodegen } = await import("@cosmicdrift/kumiko-dev-server");
    const explicit = ctx.argv[0];
    const cwd = explicit
      ? resolvePath(explicit)
      : (process.env["INIT_CWD"] ?? ctx.cwd);
    const t0 = performance.now();
    const result = runCodegen({ appRoot: cwd });
    const ms = Math.round(performance.now() - t0);
    ctx.out.log("");
    ctx.out.log(`  ✓ codegen done — ${result.eventCount} events, ${ms}ms`);
    ctx.out.log(`    output: ${result.outputDir}`);
    ctx.out.log(`    types: ${result.didWriteTypes ? "rewritten" : "unchanged"}`);
    ctx.out.log(`    define: ${result.didWriteDefine ? "rewritten" : "unchanged"}`);
    if (result.warnings.length > 0) {
      ctx.out.log("");
      ctx.out.log(`  ${result.warnings.length} warning(s):`);
      for (const w of result.warnings) {
        ctx.out.log(`    ${w.file}:${w.line} — ${w.reason}`);
      }
    }
    ctx.out.log("");
    return 0;
  },
});
