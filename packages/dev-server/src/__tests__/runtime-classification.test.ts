import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function classifyByDirective(filePath: string): string | null {
  const head = readFileSync(filePath, "utf8").slice(0, 600);
  for (const line of head.split("\n").slice(0, 8)) {
    const match = line.match(/\/\/\s*@runtime\s+(\w+)/);
    if (match) return match[1] ?? null;
  }
  return null;
}

describe("compose-stacks.ts runtime directive", () => {
  it("carries a @runtime runtime directive the guard's classifyByDirective will find", () => {
    const composeStacksPath = fileURLToPath(new URL("../compose-stacks.ts", import.meta.url));
    expect(classifyByDirective(composeStacksPath)).toBe("runtime");
  });
});
