import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitEnv } from "../_lib/git-env";
import { isGermanComment, scanGermanComments } from "../guard-comment-lang";
import { writeRepo } from "./parent-workspace-fixture";

const CLI_PATH = join(import.meta.dir, "..", "cli.ts");
const LEGACY_BIN = join(import.meta.dir, "../../../../node_modules/.bin/kumiko-guard-comment-lang");

function git(cwd: string, ...args: string[]): void {
  const proc = Bun.spawnSync(["git", "-c", "user.email=t@t.test", "-c", "user.name=t", ...args], {
    cwd,
    env: gitEnv(),
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr.toString()}`);
}

async function run(
  command: readonly string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([...command], { cwd, stdout: "pipe", stderr: "pipe", env: gitEnv() });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

function withFixtureRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "comment-lang-fixture-"));
  writeRepo(dir, { name: "comment-lang-fixture", layout: "flat" });
  // The legacy bin needs a tsconfig as ts-morph anchor in a standalone repo.
  writeFileSync(join(dir, "tsconfig.json"), "{}", "utf-8");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "checkout", "-q", "-b", "feature");
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

function addCommit(dir: string, file: string, content: string): void {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, file), content, "utf-8");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "change");
}

describe("kumiko-guards comment-lang", () => {
  test("scanner flags German markers and honours the ignore tag", () => {
    expect(isGermanComment("// wenn der Wert fehlt")).toBe(true);
    expect(isGermanComment("// returns the value when present")).toBe(false);
    const sites = scanGermanComments(
      [
        ["const a = `$", "{{ x: 1 }.x}`; // Prüfung"].join(""),
        "// kumiko-lint-ignore comment-lang legacy text für Tests",
        "const b = 1;",
      ].join("\n"),
      "f.ts",
    );
    expect(sites.map((site) => site.line)).toEqual([1]);
  });

  test("--touched fails on a newly added German comment", async () => {
    await withFixtureRepo(async (dir) => {
      addCommit(dir, "src/new.ts", "// Dieser Wert wird nicht benötigt\nexport const x = 1;\n");

      const result = await run(["bun", CLI_PATH, "comment-lang", "--touched", "--base=main"], dir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("src/new.ts");
      expect(result.stdout).toContain(":1  // Dieser Wert wird nicht benötigt");

      if (existsSync(LEGACY_BIN)) {
        const legacy = await run([LEGACY_BIN, "--touched", "--base=main"], dir);
        expect(legacy.exitCode).toBe(1);
        expect(legacy.stdout).toContain(":1  // Dieser Wert wird nicht benötigt");
      }
    });
  });

  test("--touched passes for an English comment and for an untouched German one", async () => {
    await withFixtureRepo(async (dir) => {
      addCommit(dir, "src/old.ts", "// Alt: wird nicht geändert\nexport const old = 1;\n");
      git(dir, "checkout", "-q", "main");
      git(dir, "merge", "-q", "--ff-only", "feature");
      git(dir, "checkout", "-q", "-b", "next");
      addCommit(dir, "src/new.ts", "// Explains why the value is cached\nexport const x = 1;\n");

      const result = await run(["bun", CLI_PATH, "comment-lang", "--touched", "--base=main"], dir);

      expect(result.exitCode).toBe(0);
    });
  });

  test("rejects unknown flags", async () => {
    await withFixtureRepo(async (dir) => {
      const result = await run(["bun", CLI_PATH, "comment-lang", "--bogus"], dir);
      expect(result.exitCode).toBe(1);
    });
  });
});
