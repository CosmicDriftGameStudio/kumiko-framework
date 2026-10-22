import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manualEntryId, runUpgradeCli } from "../upgrade-cli.ts";

const REAL_REPO_ROOT = join(import.meta.dir, "../../../..");

const OPEN_FIRST = { version: "0.311.0", title: "first manual change" };
const OPEN_SECOND = { version: "0.311.0", title: "second manual change" };
const withId = (entry: { version: string; title: string }) => ({
  id: manualEntryId(entry.version, entry.title),
  ...entry,
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

function fixture(): string {
  const cwd = mkdtempSync(join(tmpdir(), "kumiko-upgrade-resolve-"));
  dirs.push(cwd);
  const files: Record<string, string> = {
    "packages/framework/src/changes.json": JSON.stringify([
      { version: "0.312.0", type: "breaking", title: "single manual change" },
    ]),
    "packages/bundled-features/package.json": JSON.stringify({ version: "0.312.0" }),
    ".kumiko/upgrade-state.json": JSON.stringify({
      version: "0.312.0",
      appliedAt: "2024-01-01T00:00:00Z",
      codemods: [],
      pendingManual: [withId(OPEN_FIRST), withId(OPEN_SECOND)],
    }),
  };
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(cwd, relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return cwd;
}

test("--resolve updates the open line in CHANGELOG.md and leaves other entries open", async () => {
  const first = withId(OPEN_FIRST);
  const second = withId(OPEN_SECOND);
  const cwd = fixture();
  writeFileSync(
    join(cwd, "CHANGELOG.md"),
    `# Changelog\n\n## [0.312.0] - 2024-01-01\n\n### Manual migrations\n\n- [open] ${first.id} · 0.311.0 · first manual change\n- [open] ${second.id} · 0.311.0 · second manual change\n`,
    "utf-8",
  );

  const exit = await runUpgradeCli(
    ["--resolve", first.id, "--reason", "done by hand"],
    cwd,
    { log: () => {}, err: () => {} },
    { repoRoot: REAL_REPO_ROOT },
  );

  expect(exit).toBe(0);
  const changelog = readFileSync(join(cwd, "CHANGELOG.md"), "utf-8");
  expect(changelog).toContain(`- [migrated] ${first.id} · 0.311.0 · first manual change`);
  expect(changelog).toContain(`- [open] ${second.id} · 0.311.0 · second manual change`);
});
