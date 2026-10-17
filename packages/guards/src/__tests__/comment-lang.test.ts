import { describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitEnv } from "../_lib/git-env";
import { isGermanComment, runCommentLangCli, scanGermanComments } from "../guard-comment-lang";
import { writeRepo } from "./parent-workspace-fixture";

const CLI_PATH = join(import.meta.dir, "..", "cli.ts");

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
    expect(isGermanComment("// wenn der Wert nicht gesetzt ist")).toBe(true);
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

  test("a licence header and short English comments are not German", () => {
    expect(isGermanComment("// SPDX-License-Identifier: MIT")).toBe(false);
    expect(isGermanComment("// MIT License")).toBe(false);
    expect(isGermanComment("// retry once, then bail")).toBe(false);
    expect(isGermanComment("// the value is cached bei the caller")).toBe(false);
  });

  test("a real German sentence is flagged by markers or by an umlaut alone", () => {
    expect(isGermanComment("// Der Wert wird nicht gespeichert, wenn er fehlt")).toBe(true);
    expect(isGermanComment("// Prüfung")).toBe(true);
  });

  test("scanner honours the ignore tag inside a comma-separated slug list", () => {
    const sites = scanGermanComments(
      ["// kumiko-lint-ignore raw-sql,comment-lang legacy text für Tests", "const b = 1;"].join(
        "\n",
      ),
      "f.ts",
    );
    expect(sites).toEqual([]);
  });

  test("--touched fails on a newly added German comment", async () => {
    await withFixtureRepo(async (dir) => {
      addCommit(dir, "src/new.ts", "// Dieser Wert wird nicht benötigt\nexport const x = 1;\n");

      const result = await run(["bun", CLI_PATH, "comment-lang", "--touched", "--base=main"], dir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("src/new.ts");
      expect(result.stdout).toContain(":1  // Dieser Wert wird nicht benötigt");
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

  test("--touched reads committed content: a local uncommitted translation does not hide it", async () => {
    await withFixtureRepo(async (dir) => {
      addCommit(dir, "src/new.ts", "// Dieser Wert wird nicht benötigt\nexport const x = 1;\n");
      writeFileSync(join(dir, "src/new.ts"), "// This value is unused\nexport const x = 1;\n");

      const result = await run(["bun", CLI_PATH, "comment-lang", "--touched", "--base=main"], dir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("src/new.ts");
    });
  });

  test("--touched ignores an uncommitted German comment that is not in HEAD", async () => {
    await withFixtureRepo(async (dir) => {
      addCommit(dir, "src/new.ts", "// Explains why the value is cached\nexport const x = 1;\n");
      writeFileSync(
        join(dir, "src/new.ts"),
        "// Dieser Wert wird nicht benötigt\nexport const x = 1;\n",
      );

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

  test("a baseline file containing JSON null fails with the drift message instead of crashing", async () => {
    await withFixtureRepo(async (dir) => {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src/a.ts"), "export const a = 1;\n", "utf-8");
      writeFileSync(join(dir, ".kumiko-comment-lang-baseline.json"), "null\n", "utf-8");

      const result = await run(["bun", CLI_PATH, "comment-lang"], dir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("Baseline format drift");
      expect(result.stderr).not.toContain("TypeError");
    });
  });
});

describe("kumiko-guards comment-lang — tooling repos", () => {
  test("scans a repo whose manifest kind is tooling", async () => {
    const dir = mkdtempSync(join(tmpdir(), "comment-lang-tooling-"));
    try {
      writeRepo(dir, {
        name: "tooling-fixture",
        layout: {
          manifest: { kind: "tooling", sourceRoots: ["src"], testGlobs: ["src/**/*.test.ts"] },
        },
      });
      writeFileSync(join(dir, "src/a.ts"), "// Dieser Wert wird nicht benötigt\n", "utf-8");

      const result = await run(["bun", CLI_PATH, "comment-lang", "--list"], dir);

      expect(result.stdout).toContain("2 files checked, 1 German comment(s) found");
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scanGermanComments — division vs regex", () => {
  test("a division before a trailing German comment is not scanned as a regex", () => {
    const src = "const half = width / 2; // deutscher Kommentar hier über die Breite\n";
    expect(scanGermanComments(src, "probe.ts")).toHaveLength(1);
  });

  test("a brace inside a comment after a division does not desync later comments", () => {
    const src = [
      "const half = width / 2; // { deutscher Kommentar über die Breite",
      ["const other = `x $", "{half}`; // noch ein deutscher Kommentar für die Höhe"].join(""),
      "",
    ].join("\n");
    expect(scanGermanComments(src, "probe.ts")).toHaveLength(2);
  });

  test("a regex literal containing a brace after an operator is still scanned as a regex", () => {
    const src = [
      "const re = /\\{/;",
      ["const s = `a $", "{re}`; // deutscher Kommentar für den Test"].join(""),
      "",
    ].join("\n");
    expect(scanGermanComments(src, "probe.ts")).toHaveLength(1);
  });
});

describe("kumiko-guards comment-lang — push root", () => {
  function listedCounts(cwd: string, vars: Readonly<Record<string, string | undefined>>): string {
    const lines: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      lines.push(args.join(" "));
    });
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      runCommentLangCli(["--list"], cwd, vars);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
    return lines.join("\n");
  }

  test("a push root without a matching KUMIKO_CLI_SCOPE does not redirect the scan", () => {
    const cleanRepo = mkdtempSync(join(tmpdir(), "comment-lang-clean-"));
    const staleRepo = mkdtempSync(join(tmpdir(), "comment-lang-stale-"));
    try {
      writeRepo(cleanRepo, { name: "clean-fixture", layout: "flat" });
      writeRepo(staleRepo, { name: "stale-fixture", layout: "flat" });
      mkdirSync(join(staleRepo, "src"), { recursive: true });
      writeFileSync(join(staleRepo, "src/a.ts"), "// Dieser Wert wird nicht benötigt\n", "utf-8");

      expect(listedCounts(cleanRepo, { KUMIKO_PUSH_REPO_ROOT: staleRepo })).toContain(
        "0 German comment(s) found",
      );
      expect(
        listedCounts(cleanRepo, {
          KUMIKO_PUSH_REPO_ROOT: staleRepo,
          KUMIKO_CLI_SCOPE: "clean-fixture",
        }),
      ).toContain("0 German comment(s) found");
    } finally {
      rmSync(cleanRepo, { recursive: true, force: true });
      rmSync(staleRepo, { recursive: true, force: true });
    }
  });
});

describe("scanGermanComments — contextual keywords and non-null before a slash", () => {
  const germanTail = "// deutscher Kommentar hier über die Breite";

  test.each([
    ["non-null postfix", `const half = width! / 2; ${germanTail}`],
    ["member named from", `const half = range.from / 2; ${germanTail}`],
    ["identifier named type", `const half = type / 2; ${germanTail}`],
    ["chained non-null", `const half = a!! / 2; ${germanTail}`],
  ])("%s: division is not scanned as a regex", (_name, line) => {
    expect(scanGermanComments(`${line}\n`, "probe.ts")).toHaveLength(1);
  });

  test("negated regex literal is still scanned as a regex", () => {
    const src = [
      "const ok = !/\\{/.test(s);",
      ["const s = `a $", "{ok}`; // deutscher Kommentar für den Test"].join(""),
      "",
    ].join("\n");
    expect(scanGermanComments(src, "probe.ts")).toHaveLength(1);
  });

  test("regex after return is still scanned as a regex", () => {
    const src = [
      "function f(s: string) { return /\\{/.test(s); }",
      ["const s = `a $", "{f}`; // deutscher Kommentar für den Test"].join(""),
      "",
    ].join("\n");
    expect(scanGermanComments(src, "probe.ts")).toHaveLength(1);
  });
});
