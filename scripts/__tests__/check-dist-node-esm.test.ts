import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const checkScript = resolve(import.meta.dir, "../check-dist-node-esm.mjs");

function runCheck(files: Record<string, string>): { status: number | null; output: string } {
  const dist = mkdtempSync(join(tmpdir(), "kumiko-dist-esm-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(join(dist, name, ".."), { recursive: true });
      writeFileSync(join(dist, name), content);
    }
    const result = Bun.spawnSync(["node", checkScript, dist]);
    return { status: result.exitCode, output: result.stderr.toString() };
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
}

describe("check-dist-node-esm", () => {
  test("a relative import inside a string-array element of generated source is not an import", () => {
    const { status } = runCheck({
      "scaffold.js": `export const lines = [\n    'import { x } from "./y";',\n    "import { z } from './w';",\n];\n`,
    });
    expect(status).toBe(0);
  });

  test("a real relative import without a resolvable target still fails", () => {
    const { status, output } = runCheck({
      "index.js": `import { x } from "./missing";\n`,
    });
    expect(status).toBe(1);
    expect(output).toContain("./missing");
  });
});
