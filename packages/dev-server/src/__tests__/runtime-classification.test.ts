import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Mirrors infra/guards/runtime-isolation-classify.ts `classifyByDirective`
// as of kumiko-framework#2337 (first 600 bytes, first 8 lines,
// `// @runtime <kind>`) — guards against a reformat of compose-stacks.ts
// pushing the directive out of that window. Doesn't catch infra changing
// the window/regex itself; that lives in the infra repo's own tests.
const ALL_RUNTIMES = new Set(["runtime", "client", "dev", "tooling", "test"]);

function classifyByDirective(filePath: string): string | null {
  const head = readFileSync(filePath, "utf8").slice(0, 600);
  for (const line of head.split("\n").slice(0, 8)) {
    const match = line.match(/\/\/\s*@runtime\s+(\w+)/);
    if (match && ALL_RUNTIMES.has(match[1] ?? "")) return match[1] ?? null;
  }
  return null;
}

describe("compose-stacks.ts runtime directive", () => {
  it("carries a @runtime runtime directive the guard's classifyByDirective will find", () => {
    const composeStacksPath = fileURLToPath(new URL("../compose-stacks.ts", import.meta.url));
    expect(classifyByDirective(composeStacksPath)).toBe("runtime");
  });
});
