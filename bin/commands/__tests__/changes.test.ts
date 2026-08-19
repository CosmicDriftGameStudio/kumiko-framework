import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeContext, makeSpyOutput, makeTempCwd } from "../_test-helpers";
import { changesCommand } from "../changes";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

function tmp(files: Record<string, string>): string {
  const t = makeTempCwd(files);
  cleanups.push(t.cleanup);
  return t.cwd;
}

const BUNDLED_FEATURES_PKG = JSON.stringify({
  name: "@cosmicdrift/kumiko-bundled-features",
  version: "0.208.0",
});
const FRAMEWORK_PKG = JSON.stringify({
  name: "@cosmicdrift/kumiko-framework",
  version: "0.209.0",
});
const OLD_SESSIONS_ENTRY = JSON.stringify([{ version: "0.200.0", type: "fix", title: "old fix" }]);

async function run(cwd: string, argv: string[]): Promise<{ exit: number; logs: string[]; errs: string[] }> {
  const spy = makeSpyOutput();
  const exit = await changesCommand.run(makeContext({ cwd, argv, out: spy.out }));
  return { exit, logs: [...spy.logs], errs: [...spy.errs] };
}

describe("changes add — validation", () => {
  test("--breaking without --migration is rejected", async () => {
    const cwd = tmp({
      "packages/bundled-features/package.json": BUNDLED_FEATURES_PKG,
      "packages/bundled-features/src/sessions/changes.json": OLD_SESSIONS_ENTRY,
    });

    const { exit, errs } = await run(cwd, [
      "add",
      "--breaking",
      "--title",
      "removed helper",
      "--feature",
      "sessions",
    ]);

    expect(exit).toBe(1);
    expect(errs.join("\n")).toContain("requires --migration");
    expect(JSON.parse(readFileSync(join(cwd, "packages/bundled-features/src/sessions/changes.json"), "utf-8"))).toHaveLength(1);
  });

  test("two type flags at once are rejected", async () => {
    const cwd = tmp({
      "packages/bundled-features/package.json": BUNDLED_FEATURES_PKG,
      "packages/bundled-features/src/sessions/changes.json": OLD_SESSIONS_ENTRY,
    });

    const { exit, errs } = await run(cwd, [
      "add",
      "--fix",
      "--improvement",
      "--title",
      "x",
      "--feature",
      "sessions",
    ]);

    expect(exit).toBe(1);
    expect(errs.join("\n")).toContain("Exactly one of --breaking, --improvement, --fix");
  });

  test("missing --title is rejected", async () => {
    const cwd = tmp({
      "packages/bundled-features/package.json": BUNDLED_FEATURES_PKG,
      "packages/bundled-features/src/sessions/changes.json": OLD_SESSIONS_ENTRY,
    });

    const { exit, errs } = await run(cwd, ["add", "--fix", "--feature", "sessions"]);

    expect(exit).toBe(1);
    expect(errs.join("\n")).toContain("--title is required");
  });

  test("unresolvable --feature reports the available names", async () => {
    const cwd = tmp({
      "packages/bundled-features/package.json": BUNDLED_FEATURES_PKG,
      "packages/bundled-features/src/sessions/changes.json": OLD_SESSIONS_ENTRY,
    });

    const { exit, errs } = await run(cwd, [
      "add",
      "--fix",
      "--title",
      "x",
      "--feature",
      "does-not-exist",
    ]);

    expect(exit).toBe(1);
    expect(errs.join("\n")).toContain("sessions");
  });

  test("no --feature and an undeterminable cwd errs with the available names", async () => {
    const cwd = tmp({
      "packages/framework/package.json": FRAMEWORK_PKG,
      "packages/framework/src/changes.json": "[]",
      "packages/bundled-features/package.json": BUNDLED_FEATURES_PKG,
      "packages/bundled-features/src/sessions/changes.json": OLD_SESSIONS_ENTRY,
    });

    const { exit, errs } = await run(cwd, ["add", "--fix", "--title", "x"]);

    expect(exit).toBe(1);
    const out = errs.join("\n");
    expect(out).toContain("framework-core");
    expect(out).toContain("sessions");
  });
});

describe("changes add — writes the entry", () => {
  test("lands at the front of the array with the package's own version", async () => {
    const cwd = tmp({
      "packages/bundled-features/package.json": BUNDLED_FEATURES_PKG,
      "packages/bundled-features/src/sessions/changes.json": OLD_SESSIONS_ENTRY,
    });

    const { exit, logs } = await run(cwd, [
      "add",
      "--improvement",
      "--title",
      "faster session lookup",
      "--detail",
      "uses an index now",
      "--feature",
      "sessions",
    ]);

    const path = join(cwd, "packages/bundled-features/src/sessions/changes.json");
    expect(exit).toBe(0);
    expect(logs).toEqual([path]);

    const written = JSON.parse(readFileSync(path, "utf-8"));
    expect(written).toHaveLength(2);
    expect(written[0]).toEqual({
      version: "0.208.0",
      type: "improvement",
      title: "faster session lookup",
      detail: "uses an index now",
    });
    expect(written[1]).toEqual({ version: "0.200.0", type: "fix", title: "old fix" });
  });

  test("preserves 2-space indentation and a trailing newline", async () => {
    const cwd = tmp({
      "packages/bundled-features/package.json": BUNDLED_FEATURES_PKG,
      "packages/bundled-features/src/sessions/changes.json": OLD_SESSIONS_ENTRY,
    });

    await run(cwd, ["add", "--fix", "--title", "x", "--feature", "sessions"]);

    const raw = readFileSync(join(cwd, "packages/bundled-features/src/sessions/changes.json"), "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain('  {\n    "version"');
  });

  test("--codemod is written onto the entry", async () => {
    const cwd = tmp({
      "packages/bundled-features/package.json": BUNDLED_FEATURES_PKG,
      "packages/bundled-features/src/sessions/changes.json": OLD_SESSIONS_ENTRY,
    });

    await run(cwd, [
      "add",
      "--breaking",
      "--title",
      "renamed field",
      "--migration",
      "rename x to y",
      "--codemod",
      "scripts/codemods/rename-x-to-y.ts",
      "--feature",
      "sessions",
    ]);

    const written = JSON.parse(readFileSync(join(cwd, "packages/bundled-features/src/sessions/changes.json"), "utf-8"));
    expect(written[0].codemod).toBe("scripts/codemods/rename-x-to-y.ts");
  });

  test("--feature framework-core writes packages/framework/src/changes.json", async () => {
    const cwd = tmp({
      "packages/framework/package.json": FRAMEWORK_PKG,
      "packages/framework/src/changes.json": "[]",
      "packages/bundled-features/package.json": BUNDLED_FEATURES_PKG,
    });

    const { exit } = await run(cwd, [
      "add",
      "--fix",
      "--title",
      "core fix",
      "--feature",
      "framework-core",
    ]);

    expect(exit).toBe(0);
    const written = JSON.parse(readFileSync(join(cwd, "packages/framework/src/changes.json"), "utf-8"));
    expect(written).toEqual([{ version: "0.209.0", type: "fix", title: "core fix" }]);
  });

  test("derives --feature from a cwd nested inside the feature directory", async () => {
    const cwd = tmp({
      "packages/bundled-features/package.json": BUNDLED_FEATURES_PKG,
      "packages/bundled-features/src/sessions/changes.json": OLD_SESSIONS_ENTRY,
    });

    const { exit } = await run(join(cwd, "packages/bundled-features/src/sessions"), [
      "add",
      "--fix",
      "--title",
      "derived from cwd",
    ]);

    expect(exit).toBe(0);
    const written = JSON.parse(readFileSync(join(cwd, "packages/bundled-features/src/sessions/changes.json"), "utf-8"));
    expect(written[0].title).toBe("derived from cwd");
  });

  test("creates changes.json for a feature that doesn't have one yet", async () => {
    const cwd = tmp({
      "packages/bundled-features/package.json": BUNDLED_FEATURES_PKG,
      "packages/bundled-features/src/newfeature/feature.ts": "export {};",
    });

    const { exit } = await run(cwd, [
      "add",
      "--improvement",
      "--title",
      "first entry",
      "--feature",
      "newfeature",
    ]);

    const path = join(cwd, "packages/bundled-features/src/newfeature/changes.json");
    expect(exit).toBe(0);
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual([
      { version: "0.208.0", type: "improvement", title: "first entry" },
    ]);
  });
});

// guard-feature-changelog.ts (infra/guards, sibling repo in the parent
// workspace) enforces the schema this command writes. Skipped when the
// worktree runs in isolation without that sibling checked out.
const GUARD_PATH = join(import.meta.dir, "../../../../../infra/guards/guard-feature-changelog.ts");

describe.skipIf(!existsSync(GUARD_PATH))("changes add — guard-feature-changelog compliance", () => {
  test("a written breaking entry passes validateEntry", async () => {
    const { validateEntry } = await import(GUARD_PATH);

    const cwd = tmp({
      "packages/bundled-features/package.json": BUNDLED_FEATURES_PKG,
      "packages/bundled-features/src/sessions/changes.json": OLD_SESSIONS_ENTRY,
    });

    await run(cwd, [
      "add",
      "--breaking",
      "--title",
      "removed legacy helper",
      "--migration",
      "import from the new module instead",
      "--feature",
      "sessions",
    ]);

    const entries = JSON.parse(readFileSync(join(cwd, "packages/bundled-features/src/sessions/changes.json"), "utf-8"));
    const violations = validateEntry(entries[0], "changes.json", "test-entry");
    expect(violations).toEqual([]);
  });

  test("a written non-breaking entry passes validateEntry", async () => {
    const { validateEntry } = await import(GUARD_PATH);

    const cwd = tmp({
      "packages/bundled-features/package.json": BUNDLED_FEATURES_PKG,
      "packages/bundled-features/src/sessions/changes.json": OLD_SESSIONS_ENTRY,
    });

    await run(cwd, ["add", "--improvement", "--title", "faster lookup", "--feature", "sessions"]);

    const entries = JSON.parse(readFileSync(join(cwd, "packages/bundled-features/src/sessions/changes.json"), "utf-8"));
    const violations = validateEntry(entries[0], "changes.json", "test-entry");
    expect(violations).toEqual([]);
  });
});
