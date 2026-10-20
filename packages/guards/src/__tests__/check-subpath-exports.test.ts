import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { check } from "../check-subpath-exports";
import { fixtureRoot } from "./parent-workspace-fixture";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

function makeRepo(opts: { published: boolean; exports: Record<string, string> }) {
  const dir = mkdtempSync(join(tmpdir(), "subpath-exports-"));
  dirs.push(dir);
  write(join(dir, "package.json"), JSON.stringify({ name: "fixture" }));
  write(
    join(dir, "packages/lib/package.json"),
    JSON.stringify({
      name: "@scope/lib",
      ...(opts.published && { publishConfig: { registry: "https://registry.example" } }),
      exports: opts.exports,
    }),
  );
  write(join(dir, "packages/lib/src/billing/index.ts"), "export {};\n");
  write(join(dir, "packages/lib/src/billing/web.ts"), "export {};\n");
  return fixtureRoot("fixture", dir, {
    kind: "library",
    sourceRoots: ["packages/*/src"],
    testGlobs: ["packages/*/src/**/*.test.ts"],
  });
}

describe("Subpath Exports", () => {
  test("flags src/<feature>/web.ts that is missing in exports", async () => {
    const root = makeRepo({ published: true, exports: { "./billing": "./src/billing/index.ts" } });
    const outcome = await check.run([root]);
    expect(outcome.violations.map((v) => v.message)).toEqual([
      '"./billing/web" is missing in packages/lib/package.json exports',
    ]);
  });

  test("passes when the web subpath is exported", async () => {
    const root = makeRepo({
      published: true,
      exports: { "./billing": "./a.ts", "./billing/web": "./b.ts" },
    });
    expect((await check.run([root])).violations).toEqual([]);
  });

  test("ignores unpublished packages and unexported features", async () => {
    const unpublished = makeRepo({ published: false, exports: { "./billing": "./a.ts" } });
    expect((await check.run([unpublished])).notApplicable).toBe(true);
    const unexported = makeRepo({ published: true, exports: { "./other": "./a.ts" } });
    expect((await check.run([unexported])).violations).toEqual([]);
  });
});
