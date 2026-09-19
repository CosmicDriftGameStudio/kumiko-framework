import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// bun's bunfig parser has no `[test] timeout` key and drops unknown keys without
// a warning (#3078, #2796) — only `--timeout` on the CLI raises the 5000ms
// default, so the DOM runs must carry it on every invocation.
const repoRoot = join(import.meta.dir, "..", "..");
const DOM_TIMEOUT_FLAG = "--timeout=15000";
const DOM_CONFIG = /--config=bunfig\.(?:ci-)?dom\.toml/;

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("#");
}

describe("bun test timeout comes from the CLI, not from bunfig", () => {
  test("no bunfig declares an inert [test] timeout", () => {
    const bunfigs = readdirSync(repoRoot).filter(
      (name) => name.startsWith("bunfig") && name.endsWith(".toml"),
    );
    expect(bunfigs.length).toBeGreaterThan(0);

    const withDeadKey = bunfigs.filter((name) => /^\s*timeout\s*=/m.test(readRepoFile(name)));
    expect(withDeadKey).toEqual([]);
  });

  test("every DOM test command passes the timeout explicitly", () => {
    const sources = ["package.json", "bin/kumiko-legacy.ts"];
    const missing: string[] = [];

    for (const source of sources) {
      for (const segment of readRepoFile(source).split("\n").flatMap(splitCommands)) {
        if (!DOM_CONFIG.test(segment)) continue;
        if (!segment.includes(DOM_TIMEOUT_FLAG)) missing.push(`${source}: ${segment.trim()}`);
      }
    }

    expect(missing).toEqual([]);
  });
});

function splitCommands(line: string): string[] {
  return isCommentLine(line) ? [] : line.split("&&");
}
