// L2 AI-Eval als kumiko-CLI subcommand.
//
// **Architektur:** Eval-Pipeline + Fixtures + Cost-Reporter leben im
// `kumiko-enterprise`-repo (ai-foundation ist enterprise-only). Framework's
// CLI delegiert per subprocess in die enterprise scripts. Wenn enterprise
// nicht ausgecheckt ist (standalone framework-clone), fail-loud mit
// Hinweis.
//
// **Subcommands:**
//   bunx kumiko eval                 → eval-l2.ts (alle args durchgereicht)
//   bunx kumiko eval drift           → eval-l2-drift.ts (alle args durchgereicht)
//
// **Args werden 1:1 durchgereicht** an die zugrundeliegenden Scripts
// — Dokumentation lebt dort.
//
// **Beispiele:**
//   bunx kumiko eval --smoke
//     → free local mock-mode smoke (3 fixtures)
//   bunx kumiko eval --live --smoke --model claude-haiku-4-5
//     → ~$0.01 cloud-smoke
//   bunx kumiko eval --live --baseline --model claude-sonnet-4-6
//     → ~$0.40 weekly baseline-refresh
//   bunx kumiko eval --provider openai-compat --smoke
//     → $0 ollama-local
//   bunx kumiko eval drift --baseline docs/l2-eval-live-baseline.json --current /tmp/new.json
//     → regression-check (exit 1 wenn regressions)

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineCommand } from "./registry";
import { runStreaming } from "./_spawn";

export const evalCommand = defineCommand({
  id: "eval",
  label: "eval",
  description: "L2 AI eval (live + smoke + drift) — delegates to kumiko-enterprise/scripts",
  help: [
    "L2 AI-Eval runner — wraps the enterprise eval-pipeline.",
    "",
    "Subcommands:",
    "  kumiko eval [args]          → eval-l2.ts (live/smoke/baseline)",
    "  kumiko eval drift [args]    → eval-l2-drift.ts (regression detection)",
    "",
    "Common args (eval):",
    "  --smoke                       3-fixture subset (~$0.30 with Sonnet, $0 local)",
    "  --live                        hit a real provider (default: Anthropic)",
    "  --baseline                    write checked-in baseline JSON",
    "  --model <name>                claude-opus-4-7 | claude-sonnet-4-6 | claude-haiku-4-5",
    "  --provider openai-compat      switch to OpenAI-compat (Ollama/vLLM)",
    "  --endpoint <url>              OpenAI-compat endpoint (default Ollama localhost)",
    "  --max-tokens <n>              output cap (default 4000)",
    "  --effort <high|xhigh|...>     Opus-only thinking effort (default high)",
    "  --filter <id-substring>       run only fixtures matching this substring",
    "",
    "Common args (drift):",
    "  --baseline <path>             reference report JSON",
    "  --current <path>              new report JSON to compare",
    "  --threshold <n>               score-drop threshold per fixture (default 0.05)",
    "  --json                        machine-readable output",
  ].join("\n"),
  category: "ops",
  roles: ["maintainer"],
  run: async (ctx) => {
    // ctx.repoRoot is framework-dir (kumiko.ts uses import.meta.dir/..).
    // Enterprise lives as a sibling under the workspace parent. Resolve
    // up one level then back down.
    const enterpriseRoot = resolve(ctx.repoRoot, "..", "kumiko-enterprise");
    if (!existsSync(enterpriseRoot)) {
      ctx.out.err(
        `kumiko eval: expected sibling repo at ${enterpriseRoot} — not found.\n` +
          `         The L2 AI-Eval lives in kumiko-enterprise (private). Clone it next to kumiko-framework, or run\n` +
          `         the scripts directly via bun if you're outside the workspace.`,
      );
      return 1;
    }

    const [sub, ...rest] = ctx.argv;
    const scriptPath =
      sub === "drift"
        ? join(enterpriseRoot, "scripts/eval-l2-drift.ts")
        : join(enterpriseRoot, "scripts/eval-l2.ts");
    // Wenn sub kein argument vorne ist, alle args durchreichen. Wenn sub
    // == "drift", schluck ihn (war nur Routing).
    const forwardedArgs = sub === "drift" ? rest : ctx.argv;

    if (!existsSync(scriptPath)) {
      ctx.out.err(
        `kumiko eval: ${scriptPath} missing — enterprise repo present but eval-scripts not.\n` +
          `         The enterprise checkout might be on an older branch. Pull main + retry.`,
      );
      return 1;
    }

    // Subprocess: bun runs the .ts directly (enterprise scripts use bun's
    // built-in TypeScript loader). cwd = enterpriseRoot so relative paths
    // in the script (docs/, packages/) resolve correctly.
    return runStreaming("bun", [scriptPath, ...forwardedArgs], ctx.out, {
      cwd: enterpriseRoot,
    });
  },
});
