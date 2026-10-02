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
