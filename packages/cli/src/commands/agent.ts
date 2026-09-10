import { join } from "node:path";
import type { CliCommand } from "./types";

const LINT_SUBCOMMAND = "lint";

export const agentCommand: CliCommand = {
  id: "agent",
  description: "AI-agent tooling (lint)",
  help: "Reads kumiko.config.ts in cwd and reports handler definitions the AI\nagent can't describe (exposed to the agent without a usable description).\n\nSubcommands:\n  lint                  Report AI-agent-doc gaps in the current config\n",
  run: async (ctx) => {
    const sub = ctx.argv[0];
    if (sub !== LINT_SUBCOMMAND) {
      ctx.out.err("");
      ctx.out.err(`  Usage: kumiko agent <${LINT_SUBCOMMAND}>`);
      ctx.out.err("");
      return 1;
    }

    const configPath = join(ctx.cwd, "kumiko.config.ts");
    if (!(await Bun.file(configPath).exists())) {
      ctx.out.err("");
      ctx.out.err(`  kumiko.config.ts not found at: ${configPath}`);
      ctx.out.err("");
      ctx.out.err("  Create a file that exports your features:");
      ctx.out.err("    // kumiko.config.ts");
      ctx.out.err('    import { myFeature } from "./src/features/my-feature";');
      ctx.out.err("    export default { features: [myFeature] };");
      ctx.out.err("");
      return 1;
    }

    const config = (await import(configPath)).default as {
      features: readonly import("@cosmicdrift/kumiko-framework/engine").FeatureDefinition[];
    };
    const { findAgentDocGaps, formatAgentDocGap } = await import(
      "@cosmicdrift/kumiko-bundled-features/agent-tools"
    );

    const gaps = findAgentDocGaps(config.features);

    if (gaps.length === 0) {
      ctx.out.log("");
      ctx.out.log("  ✓ No AI-agent doc gaps found.");
      ctx.out.log("");
      return 0;
    }

    ctx.out.log("");
    ctx.out.log(`  ${gaps.length} AI-agent doc gap${gaps.length === 1 ? "" : "s"} found:`);
    ctx.out.log("");
    for (const gap of gaps) {
      ctx.out.log(`    ${formatAgentDocGap(gap)}`);
    }
    ctx.out.log("");
    return 1;
  },
};
