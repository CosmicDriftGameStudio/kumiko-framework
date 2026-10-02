import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "../check-runtime-isolation";
import { fixtureRoot } from "./parent-workspace-fixture";

describe("Runtime-Isolation check.run — repo kind scope", () => {
  test("a tooling root is notApplicable, an app root with a source file is not", () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-isolation-kind-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "plain.ts"), "export const value = 1;\n");
      const manifest = { sourceRoots: ["src"], testGlobs: ["src/**/*.test.ts"] };

      const tooling = check.run([
        fixtureRoot("tooling-repo", dir, { ...manifest, kind: "tooling" }),
      ]);
      expect(tooling).toMatchObject({ notApplicable: true, violations: [] });

      const app = check.run([fixtureRoot("app-repo", dir, { ...manifest, kind: "app" })]);
      expect(app).toMatchObject({ notApplicable: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Runtime-Isolation check.run — violation line resolution", () => {
  test("each regression points at its own import line, not the file's first violation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-isolation-lines-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "dev-a.ts"), "// @runtime dev\nexport const a = 1;\n");
      writeFileSync(join(dir, "src", "dev-b.ts"), "// @runtime dev\nexport const b = 1;\n");
      writeFileSync(
        join(dir, "src", "entry.ts"),
        [
          "// @runtime runtime",
          'import { a } from "./dev-a";',
          "",
          "",
          'import { b } from "./dev-b";',
          "export const both = [a, b];",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(dir, ".kumiko-runtime-isolation-baseline.json"),
        JSON.stringify({ format: 1, generated: "fixture", total: 0, perFile: {} }),
      );
      const manifest = {
        kind: "app" as const,
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      };

      const { violations } = await check.run([fixtureRoot("app-repo", dir, manifest)]);

      const lineByViolationKey = Object.fromEntries(
        violations.map((v) => [v.file, v.line] as const),
      );
      expect(violations).toHaveLength(2);
      expect(lineByViolationKey).toEqual({
        "src/entry.ts::./dev-a": 2,
        "src/entry.ts::./dev-b": 5,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
