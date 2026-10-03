import { describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runRepoChecksCli } from "../run-repo-checks";
import { fixtureRoot } from "./parent-workspace-fixture";

function expectError(argv: readonly string[], message: string): Promise<void> {
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});
  return runRepoChecksCli(argv)
    .then((code) => {
      expect(code).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(message));
    })
    .finally(() => errorSpy.mockRestore());
}

describe("runRepoChecksCli — --write-baseline", () => {
  test("--write-baseline without --guard is rejected", async () => {
    await expectError(["--write-baseline"], "--write-baseline needs --guard=<name>");
  });

  test("--guard without --write-baseline is rejected", async () => {
    await expectError(["--guard=guard-raw-sql"], "only valid with --write-baseline");
  });

  test("unknown check name is rejected and lists the known names", async () => {
    await expectError(["--write-baseline", "--guard=nope"], "guard-raw-sql");
  });

  test("a check without writeBaseline is rejected", async () => {
    await expectError(["--write-baseline", "--guard=Thin-Wrappers Guard"], "no ratchet baseline");
  });

  test("--write-baseline --guard=guard-raw-sql writes the baseline file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "raw-sql-cli-"));
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(
        join(dir, "src/x.ts"),
        '// kumiko-lint-ignore raw-sql reason here\nawait client.unsafe("SELECT 1");\n',
      );
      const root = fixtureRoot("app-repo", dir, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const code = await runRepoChecksCli(["--write-baseline", "--guard=guard-raw-sql"], [root]);
      expect(code).toBe(0);
      expect(existsSync(join(dir, ".kumiko-raw-sql-baseline.json"))).toBe(true);
    } finally {
      logSpy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
