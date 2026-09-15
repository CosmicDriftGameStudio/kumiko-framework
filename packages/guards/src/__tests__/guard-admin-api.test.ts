// infra#502: guard-admin-api used to skip app repos (kind "app" was treated as unregistered), so app repos went unscanned while reporting green.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project } from "ts-morph";
import { filesForGuard } from "../_lib/guard-kit";
import { guard } from "../guard-admin-api";
import { fixtureRoot } from "./parent-workspace-fixture";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "kumiko-guard-admin-api-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  // realpath: macOS tmpdir() is a /var/folders symlink into /private/var/folders, which resolveRepoRoots() resolves too.
  return realpathSync(root);
}

describe("guard-admin-api — App-Repo-Scope (infra#502)", () => {
  test("filesForGuard(guard) nimmt eine Datei aus einem flat-src/-App-Repo mit auf", () => {
    // Explicit `roots` (fixtureRoot), not resolveRepoRoots(): fails if the guard's scan stops reaching a kind "app" root.
    const ws = workspace();
    const moneyHorseDir = join(ws, "money-horse");
    mkdirSync(join(moneyHorseDir, "src"), { recursive: true });
    const targetFile = join(moneyHorseDir, "src/foo.ts");
    writeFileSync(targetFile, "export const x = 1;\n", "utf-8");

    const roots = [
      fixtureRoot("money-horse", moneyHorseDir, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.{test,integration}.{ts,tsx}"],
      }),
    ];

    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(targetFile, "export const x = 1;\n");

    const files = filesForGuard(project, guard, roots);

    expect(files.map((f) => String(f.getFilePath()))).toContain(targetFile);
  });

  test("ein tatsächlicher appendRaw-Aufruf in einem App-Repo-src/-Layout wird als Verstoß erkannt", () => {
    // The packages/samples/scripts-shaped ALLOWLIST regexes must not wave through a src/-layout path.
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "src/features/money-horse/legacy-import.ts",
      `import { appendRaw } from "@cosmicdrift/kumiko-framework/event-store/admin-api";
export function runImport() {
	appendRaw({ streamId: "x", event: {} });
}`,
    );

    const outcome = guard.run([sf]);
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.message).toContain("appendRaw");
  });
});
