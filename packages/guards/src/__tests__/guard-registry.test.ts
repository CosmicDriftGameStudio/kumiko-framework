import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GUARDS } from "../run-guards";
import { REPO_CHECKS } from "../run-repo-checks";
import { UI_GUARDS } from "../run-ui-guards";

const SRC_DIR = join(import.meta.dir, "..");

// Guard files without a `guard`/`check` export are CLIs wired as kumiko-guards subcommands in cli.ts.
const STANDALONE_SUBCOMMANDS: Readonly<Record<string, string>> = {
  "guard-comment-lang.ts": "comment-lang",
  "guard-public-exports-changelog.ts": "public-exports-changelog",
  "check-licenses.ts": "licenses",
  "check-outdated.ts": "outdated",
  "check-security.ts": "security",
};

const guardFiles = readdirSync(SRC_DIR).filter((file) => /^(guard|check)-.+\.ts$/.test(file));
const registeredNames = new Set(
  [...GUARDS, ...UI_GUARDS, ...REPO_CHECKS].map((entry) => entry.name),
);

async function exportedName(file: string): Promise<string | undefined> {
  const mod: Record<string, unknown> = await import(join(SRC_DIR, file));
  const entry = mod["guard"] ?? mod["check"];
  if (typeof entry !== "object" || entry === null || !("name" in entry)) return undefined;
  return typeof entry.name === "string" ? entry.name : undefined;
}

describe("guard registry matches the guard files", () => {
  test("every guard-*/check-* file is registered or a wired standalone subcommand", async () => {
    const cliSource = readFileSync(join(SRC_DIR, "cli.ts"), "utf-8");
    const problems: string[] = [];
    for (const file of guardFiles) {
      const standalone = STANDALONE_SUBCOMMANDS[file];
      if (standalone !== undefined) {
        if (!cliSource.includes(`"${standalone}"`))
          problems.push(`${file}: no ${standalone} subcommand in cli.ts`);
        continue;
      }
      const name = await exportedName(file);
      if (name === undefined) problems.push(`${file}: exports neither guard nor check`);
      else if (!registeredNames.has(name)) problems.push(`${file}: "${name}" is in no registry`);
    }
    expect(problems).toEqual([]);
  });

  test("every registry entry comes from a guard file", async () => {
    const fileNames = new Set<string>();
    for (const file of guardFiles) {
      const name = await exportedName(file);
      if (name !== undefined) fileNames.add(name);
    }
    expect([...registeredNames].filter((name) => !fileNames.has(name))).toEqual([]);
  });
});
