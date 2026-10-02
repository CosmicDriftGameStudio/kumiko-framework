// Pins which bundled handlers an agent may see and at what risk. Removing
// `agent: { expose: false }` from a token/secret flow, or `risk: "high"` from
// an irreversible handler, shows up as a snapshot diff instead of passing
// silently. Update the snapshot only for an exposure change you intend.

import { describe, expect, test } from "bun:test";
import { resolveAgentExposure } from "@cosmicdrift/kumiko-framework/engine";
import config from "../../kumiko.config";

function exposureLines(): string[] {
  const lines: string[] = [];
  for (const feature of config.features) {
    for (const [name, def] of Object.entries(feature.writeHandlers)) {
      const { expose, risk } = resolveAgentExposure(def, "write");
      lines.push(`${feature.name}:write:${name} expose=${expose} risk=${risk}`);
    }
    for (const [name, def] of Object.entries(feature.queryHandlers)) {
      const { expose, risk } = resolveAgentExposure(def, "query");
      lines.push(`${feature.name}:query:${name} expose=${expose} risk=${risk}`);
    }
  }
  return lines.sort();
}

describe("use-all-bundled agent exposure", () => {
  test("every bundled handler keeps its recorded expose and risk", () => {
    const lines = exposureLines();
    expect(lines.length).toBeGreaterThan(100);
    expect(lines).toMatchSnapshot();
  });
});
