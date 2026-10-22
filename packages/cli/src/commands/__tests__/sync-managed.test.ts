import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSyncManaged } from "../sync-managed";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("runSyncManaged from a subdirectory", () => {
  test("resolves the repo root instead of treating cwd as the app", async () => {
    const root = mkdtempSync(join(tmpdir(), "kumiko-sync-managed-"));
    tmpDirs.push(root);
    const sub = join(root, "src");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "sync-app" }));
    writeFileSync(
      join(root, "kumiko.json"),
      JSON.stringify({
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
        uiRoots: [],
      }),
    );
    writeFileSync(join(root, "kumiko.config.ts"), "export default { features: [] };\n");
    const logs: string[] = [];

    const code = await runSyncManaged({
      argv: ["--write"],
      cwd: sub,
      out: { log: (s) => logs.push(s), err: (s) => logs.push(s) },
    });

    expect(code).toBe(0);
    expect(existsSync(join(root, ".husky", "pre-push"))).toBe(true);
    expect(existsSync(join(sub, ".husky"))).toBe(false);
    expect(existsSync(join(sub, "deploy"))).toBe(false);
  });
});
