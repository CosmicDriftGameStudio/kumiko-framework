import { defineFeature, type FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { findAgentDocGaps, formatAgentDocGap } from "./agent-doc-lint";

export const AGENT_TOOLS_FEATURE_NAME = "agent-tools";

export function createAgentToolsFeature(): FeatureDefinition {
  return defineFeature(AGENT_TOOLS_FEATURE_NAME, (r) => {
    r.describe(
      "Builds a tool catalog and an agent manifest from the mounted registry so an LLM agent can call handlers and understand the app's shape. A handler, custom screen, or entity without a `description` stays invisible to the agent by construction (see `resolveAgentExposure`) — this feature surfaces those gaps at boot and via `kumiko agent lint` so an app author notices before an agent silently can't see a feature.",
    );
    r.uiHints({
      displayLabel: "AI Agent Tools",
      category: "ai",
      recommended: false,
    });

    // Warns instead of throwing: undocumented handlers/screens/entities are a
    // usability gap for the agent, not an invalid app — failing the boot here
    // would turn every incrementally-documented app into an outage.
    r.bootCheck(({ features }) => {
      const gaps = findAgentDocGaps(features);
      if (gaps.length === 0) return;
      // biome-ignore lint/suspicious/noConsole: operator-visibility at boot for agent-doc gaps
      console.warn(
        `[agent-tools] ${gaps.length} handler/screen/entity gap(s) invisible to the AI agent — run \`kumiko agent lint\` for details:`,
      );
      for (const gap of gaps) {
        // biome-ignore lint/suspicious/noConsole: operator-visibility at boot for agent-doc gaps
        console.warn(`  ${formatAgentDocGap(gap)}`);
      }
    });
  });
}
