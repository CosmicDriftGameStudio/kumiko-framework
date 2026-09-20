import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { makeContext, makeSpyOutput, makeTempCwd } from "../_test-helpers";
import { changesCommand } from "../changes";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups.length = 0;
});

function tmp(files: Record<string, string>): string {
  const temp = makeTempCwd(files);
  cleanups.push(temp.cleanup);
  return temp.cwd;
}

async function run(cwd: string, argv: string[]): Promise<{ exit: number; logs: string[]; errs: string[] }> {
  const spy = makeSpyOutput();
  const exit = await changesCommand.run(makeContext({ cwd, argv, out: spy.out }));
  return { exit, logs: [...spy.logs], errs: [...spy.errs] };
}

const FRAMEWORK_PACKAGE = JSON.stringify({ name: "@cosmicdrift/kumiko-framework", version: "0.276.0" });
const BUNDLED_FEATURES_PACKAGE = JSON.stringify({
  name: "@cosmicdrift/kumiko-bundled-features",
  version: "0.276.0",
});
const GUARDS_PACKAGE = JSON.stringify({ name: "@cosmicdrift/kumiko-guards", version: "0.34.1" });

function frameworkFixture(): Record<string, string> {
  return {
    "packages/framework/package.json": FRAMEWORK_PACKAGE,
    "packages/framework/src/changes.json": "[]",
  };
}

describe("changes add", () => {
  test("rejects multiple type flags", async () => {
    const cwd = tmp({
      "packages/bundled-features/package.json": BUNDLED_FEATURES_PACKAGE,
      "packages/bundled-features/src/sessions/changes.json": "[]",
    });

    const result = await run(cwd, ["add", "--fix", "--improvement", "--title", "x", "--feature", "sessions"]);

    expect(result.exit).toBe(1);
    expect(result.errs.join("\n")).toContain("Exactly one of --breaking, --improvement, or --fix");
  });

  test("writes structured metadata to a new changeset", async () => {
    const cwd = tmp(frameworkFixture());

    const result = await run(cwd, [
      "add",
      "--breaking",
      "--title",
      "Remove the old flow",
      "--migration",
      "Use the new flow",
      "--detail",
      "Update callers first.",
      "--feature",
      "framework",
    ]);

    expect(result.exit).toBe(0);
    expect(result.logs).toHaveLength(1);
    const path = result.logs[0]!;
    expect(path).toEndWith(".changeset/framework-remove-the-old-flow.md");
    const written = readFileSync(path, "utf-8");
    expect(written).toContain('"@cosmicdrift/kumiko-framework": minor');
    expect(written).toContain("migration: |\n  Use the new flow");
    expect(readFileSync(join(cwd, "packages/framework/src/changes.json"), "utf-8")).toBe("[]");
  });

  test("derives the feature from a nested feature cwd", async () => {
    const cwd = tmp({
      "packages/bundled-features/package.json": BUNDLED_FEATURES_PACKAGE,
      "packages/bundled-features/src/sessions/feature.ts": "export {};",
      "packages/bundled-features/src/sessions/changes.json": "[]",
    });

    const result = await run(join(cwd, "packages/bundled-features/src/sessions"), [
      "add",
      "--fix",
      "--title",
      "Derived feature",
    ]);

    expect(result.exit).toBe(0);
    expect(result.logs[0]).toEndWith(".changeset/sessions-derived-feature.md");
  });

  test("rejects breaking changes without migration", async () => {
    const cwd = tmp({
      "packages/bundled-features/package.json": BUNDLED_FEATURES_PACKAGE,
      "packages/bundled-features/src/sessions/changes.json": "[]",
    });

    const result = await run(cwd, ["add", "--breaking", "--title", "Remove it", "--feature", "sessions"]);

    expect(result.exit).toBe(1);
    expect(result.errs.join("\n")).toContain("requires --migration");
    expect(existsSync(join(cwd, ".changeset"))).toBe(false);
  });

  test("resolves a standalone framework package (packages/guards) as a feature target", async () => {
    const cwd = tmp({
      ...frameworkFixture(),
      "packages/guards/package.json": GUARDS_PACKAGE,
    });

    const result = await run(cwd, [
      "add",
      "--fix",
      "--title",
      "Spawned git calls no longer inherit GIT_DIR",
      "--detail",
      "Guards now pass an allowlisted environment to git.",
      "--feature",
      "guards",
    ]);

    expect(result.exit).toBe(0);
    const path = result.logs[0]!;
    expect(path).toContain(`${sep}.changeset${sep}guards-`);
    expect(path).toEndWith(".md");
    const written = readFileSync(path, "utf-8");
    expect(written).toContain('"@cosmicdrift/kumiko-guards": patch');
    expect(written).toContain("feature: guards");
    // packages/guards has no changes.json yet — changes add must not create one
    // (it's written by `changes fold` on first release, same as a bundled feature).
    expect(existsSync(join(cwd, "packages/guards/src/changes.json"))).toBe(false);
  });

  function availableFeatures(errs: string[]): string[] {
    const match = errs.join("\n").match(/Available: (.+)$/m);
    if (!match?.[1]) throw new Error(`no "Available:" list in errors: ${errs.join("\n")}`);
    return match[1].split(", ");
  }

  test("does not resolve packages/bundled-features itself as a feature target", async () => {
    const cwd = tmp({
      ...frameworkFixture(),
      "packages/bundled-features/package.json": BUNDLED_FEATURES_PACKAGE,
      "packages/bundled-features/src/sessions/changes.json": "[]",
      "packages/guards/package.json": GUARDS_PACKAGE,
    });

    const result = await run(cwd, ["add", "--fix", "--title", "x", "--feature", "bundled-features"]);

    expect(result.exit).toBe(1);
    expect(result.errs.join("\n")).toContain('Unknown feature "bundled-features"');
    const available = availableFeatures(result.errs);
    expect(available).not.toContain("bundled-features");
    expect(available).toContain("sessions");
    expect(available).toContain("guards");
  });

  test("does not resolve a packages/<name> directory without its own package.json", async () => {
    const cwd = tmp({
      ...frameworkFixture(),
      "packages/dist-only/README.md": "not a package",
    });

    const result = await run(cwd, ["add", "--fix", "--title", "x", "--feature", "dist-only"]);

    expect(result.exit).toBe(1);
    expect(result.errs.join("\n")).toContain('Unknown feature "dist-only"');
    expect(availableFeatures(result.errs)).not.toContain("dist-only");
  });

  test("still resolves framework via its own special case when a standalone package also exists", async () => {
    const cwd = tmp({
      ...frameworkFixture(),
      "packages/guards/package.json": GUARDS_PACKAGE,
    });

    const result = await run(cwd, ["add", "--fix", "--title", "Framework-only change", "--feature", "framework"]);

    expect(result.exit).toBe(0);
    const written = readFileSync(result.logs[0]!, "utf-8");
    expect(written).toContain('"@cosmicdrift/kumiko-framework": patch');
    expect(written).toContain("feature: framework");
  });
});

describe("changes fold", () => {
  test("folds a changeset into the feature changelog with the release version", async () => {
    const cwd = tmp({
      ...frameworkFixture(),
      "packages/framework/src/changes.json": JSON.stringify([
        { version: "0.275.0", type: "fix", title: "Previous fix" },
      ]),
      ".changeset/framework-fix.md": `---\n"@cosmicdrift/kumiko-framework": patch\n---\n\nFixes the framework flow.\n\n<!-- kumiko-changes\nfeature: framework\ntype: fix\ntitle: Fixes the framework flow\n-->\n`,
      ".changeset-status.json": JSON.stringify({
        changesets: [{ id: "framework-fix" }],
        releases: [
          {
            name: "@cosmicdrift/kumiko-framework",
            newVersion: "0.277.0",
            changesets: ["framework-fix"],
          },
        ],
      }),
    });

    const first = await run(cwd, ["fold", "--status", join(cwd, ".changeset-status.json")]);
    expect(first.exit).toBe(0);
    expect(JSON.parse(readFileSync(join(cwd, "packages/framework/src/changes.json"), "utf-8"))).toEqual([
      { version: "0.277.0", type: "fix", title: "Fixes the framework flow" },
      { version: "0.275.0", type: "fix", title: "Previous fix" },
    ]);

    const second = await run(cwd, ["fold", "--status", join(cwd, ".changeset-status.json")]);
    expect(second.exit).toBe(0);
    expect(JSON.parse(readFileSync(join(cwd, "packages/framework/src/changes.json"), "utf-8"))).toHaveLength(2);
  });

  test("reads all target changelogs before writing any updates", async () => {
    const cwd = tmp({
      ...frameworkFixture(),
      "packages/framework/src/changes.json": JSON.stringify([
        { version: "0.275.0", type: "fix", title: "Previous framework fix" },
      ]),
      "packages/bundled-features/package.json": BUNDLED_FEATURES_PACKAGE,
      "packages/bundled-features/src/sessions/changes.json": "not json",
      ".changeset/a-framework-fix.md": `---\n"@cosmicdrift/kumiko-framework": patch\n---\n\nFramework fix.\n\n<!-- kumiko-changes\nfeature: framework\ntype: fix\ntitle: Framework fix\n-->\n`,
      ".changeset/b-sessions-fix.md": `---\n"@cosmicdrift/kumiko-bundled-features": patch\n---\n\nSessions fix.\n\n<!-- kumiko-changes\nfeature: sessions\ntype: fix\ntitle: Sessions fix\n-->\n`,
      ".changeset-status.json": JSON.stringify({
        changesets: [{ id: "a-framework-fix" }, { id: "b-sessions-fix" }],
        releases: [
          {
            name: "@cosmicdrift/kumiko-framework",
            newVersion: "0.277.0",
            changesets: ["a-framework-fix"],
          },
          {
            name: "@cosmicdrift/kumiko-bundled-features",
            newVersion: "0.277.0",
            changesets: ["b-sessions-fix"],
          },
        ],
      }),
    });

    const result = await run(cwd, ["fold", "--status", join(cwd, ".changeset-status.json")]);

    expect(result.exit).toBe(1);
    expect(result.errs.join("\n")).toContain("invalid changelog");
    expect(JSON.parse(readFileSync(join(cwd, "packages/framework/src/changes.json"), "utf-8"))).toEqual([
      { version: "0.275.0", type: "fix", title: "Previous framework fix" },
    ]);
  });

  test("--dry-run names changeset file and feature when the feature does not resolve", async () => {
    const cwd = tmp({
      ...frameworkFixture(),
      ".changeset/framework-log-4xx.md": `---\n"@cosmicdrift/kumiko-framework": patch\n---\n\nLogs rejected 4xx handlers.\n\n<!-- kumiko-changes\nfeature: api\ntype: fix\ntitle: Logs rejected 4xx handlers\n-->\n`,
      ".changeset-status.json": JSON.stringify({
        changesets: [{ id: "framework-log-4xx" }],
        releases: [
          {
            name: "@cosmicdrift/kumiko-framework",
            newVersion: "0.277.0",
            changesets: ["framework-log-4xx"],
          },
        ],
      }),
    });

    const result = await run(cwd, ["fold", "--status", join(cwd, ".changeset-status.json"), "--dry-run"]);

    expect(result.exit).toBe(1);
    expect(result.errs.join("\n")).toContain('.changeset/framework-log-4xx.md: unknown feature "api"');
    expect(readFileSync(join(cwd, "packages/framework/src/changes.json"), "utf-8")).toBe("[]");
  });

  test("--dry-run reports the resolved update without writing it", async () => {
    const cwd = tmp({
      ...frameworkFixture(),
      ".changeset/framework-fix.md": `---\n"@cosmicdrift/kumiko-framework": patch\n---\n\nFixes the framework flow.\n\n<!-- kumiko-changes\nfeature: framework\ntype: fix\ntitle: Fixes the framework flow\n-->\n`,
      ".changeset-status.json": JSON.stringify({
        changesets: [{ id: "framework-fix" }],
        releases: [
          {
            name: "@cosmicdrift/kumiko-framework",
            newVersion: "0.277.0",
            changesets: ["framework-fix"],
          },
        ],
      }),
    });

    const result = await run(cwd, ["fold", "--status", join(cwd, ".changeset-status.json"), "--dry-run"]);

    expect(result.exit).toBe(0);
    expect(result.logs.join("\n")).toContain("would update");
    expect(readFileSync(join(cwd, "packages/framework/src/changes.json"), "utf-8")).toBe("[]");
  });
});
