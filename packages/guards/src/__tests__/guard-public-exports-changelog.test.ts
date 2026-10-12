import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project } from "ts-morph";
import {
  compareVersionsLocal,
  diffExports,
  evaluatePublicExportsChangelog,
  exportNamesForEntry,
  isCoveredByChangelog,
  loadChangesetParser,
  loadPendingBreakingChanges,
  owningChangelogPath,
  pendingBreakingChangesIn,
  runPublicExportsChangelogCli,
  writeBaseline,
} from "../guard-public-exports-changelog";

const REAL_FRAMEWORK_ROOT = join(import.meta.dir, "../../../..");

function tmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("exportNamesForEntry", () => {
  test("collects export names from a simple file, sorted", () => {
    const dir = tmpDir("public-exports-entry-");
    try {
      const file = join(dir, "entry.ts");
      writeFileSync(file, "export const foo = 1;\nexport function bar() {}\n");
      const project = new Project({ useInMemoryFileSystem: false });
      expect(exportNamesForEntry(project, file)).toEqual(["bar", "foo"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("resolves re-exports through a barrel (export * from)", () => {
    const dir = tmpDir("public-exports-barrel-");
    try {
      writeFileSync(join(dir, "inner.ts"), "export const innerThing = 1;\n");
      const entry = join(dir, "index.ts");
      writeFileSync(entry, 'export * from "./inner";\nexport const ownThing = 2;\n');
      const project = new Project({ useInMemoryFileSystem: false });
      expect(exportNamesForEntry(project, entry)).toEqual(["innerThing", "ownThing"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("diffExports", () => {
  test("nothing missing → no findings", () => {
    const baseline = { framework: { "./auth": ["Foo", "bar"] } };
    expect(diffExports(baseline, baseline)).toEqual([]);
  });

  test("one name missing from a key", () => {
    const baseline = { framework: { "./auth": ["Foo", "bar"] } };
    const current = { framework: { "./auth": ["Foo"] } };
    expect(diffExports(baseline, current)).toEqual([
      { pkg: "framework", key: "./auth", names: ["bar"] },
    ]);
  });

  test("a whole key disappeared", () => {
    const baseline = {
      framework: { "./auth": ["Foo", "bar"], "./api": ["Baz"] },
    };
    const current = { framework: { "./api": ["Baz"] } };
    expect(diffExports(baseline, current)).toEqual([
      { pkg: "framework", key: "./auth", names: ["Foo", "bar"] },
    ]);
  });

  test("baseline has a key current does not know about at all (pkg missing)", () => {
    const baseline = { "bundled-features": { "./audit": ["AuditLog"] } };
    const current = {};
    expect(diffExports(baseline, current)).toEqual([
      { pkg: "bundled-features", key: "./audit", names: ["AuditLog"] },
    ]);
  });
});

describe("owningChangelogPath", () => {
  test("framework → always the single core changelog, regardless of key", () => {
    expect(owningChangelogPath("framework", "./auth")).toBe("packages/framework/src/changes.json");
    expect(owningChangelogPath("framework", "./api")).toBe("packages/framework/src/changes.json");
  });

  test("bundled-features → per-feature changelog, feature = first path segment", () => {
    expect(owningChangelogPath("bundled-features", "./audit/web")).toBe(
      "packages/bundled-features/src/audit/changes.json",
    );
    expect(owningChangelogPath("bundled-features", "./audit")).toBe(
      "packages/bundled-features/src/audit/changes.json",
    );
  });
});

describe("compareVersionsLocal", () => {
  test("equal versions compare to 0", () => {
    expect(compareVersionsLocal("1.2.3", "1.2.3")).toBe(0);
  });

  test("numeric per-segment compare (not lexicographic)", () => {
    expect(compareVersionsLocal("1.10.0", "1.2.0")).toBeGreaterThan(0);
    expect(compareVersionsLocal("1.2.0", "1.10.0")).toBeLessThan(0);
  });

  test("prerelease suffix is stripped before compare", () => {
    expect(compareVersionsLocal("1.0.0-rc.1", "1.0.0")).toBe(0);
    expect(compareVersionsLocal("0.219.0-rc.1", "0.219.0")).toBe(0);
  });
});

describe("isCoveredByChangelog", () => {
  test("no entry → not covered", () => {
    expect(isCoveredByChangelog([], "1.0.0")).toBe(false);
  });

  test("only an improvement entry with a higher version → not covered (wrong type)", () => {
    expect(isCoveredByChangelog([{ type: "improvement", version: "2.0.0" }], "1.0.0")).toBe(false);
  });

  test("a breaking entry below asOfVersion → not covered", () => {
    expect(isCoveredByChangelog([{ type: "breaking", version: "0.9.0" }], "1.0.0")).toBe(false);
  });

  test("a breaking entry at exactly asOfVersion → covered (production case: the fix's own entry lands at the still-unbumped current version)", () => {
    expect(isCoveredByChangelog([{ type: "breaking", version: "1.0.0" }], "1.0.0")).toBe(true);
  });

  test("a breaking entry above asOfVersion → covered", () => {
    expect(isCoveredByChangelog([{ type: "breaking", version: "1.0.1" }], "1.0.0")).toBe(true);
  });

  test("breaking entry at asOfVersion that does not name the drop → not covered", () => {
    expect(
      isCoveredByChangelog(
        [{ type: "breaking", version: "1.0.0", title: "unrelated API change" }],
        "1.0.0",
        ["logout"],
      ),
    ).toBe(false);
  });

  test("breaking entry that names the dropped export in title → covered", () => {
    expect(
      isCoveredByChangelog(
        [{ type: "breaking", version: "1.0.0", title: "logout removed from auth" }],
        "1.0.0",
        ["logout"],
      ),
    ).toBe(true);
  });
});

// End-to-end: a mini package + entry file + baseline, simulating a rename
// (one of two exports disappears), verified against evaluatePublicExportsChangelog.
describe("evaluatePublicExportsChangelog — end to end", () => {
  function buildFixture(): {
    cwd: string;
    project: Project;
    baselinePath: string;
  } {
    const cwd = tmpDir("public-exports-e2e-");
    const baselinePath = join(cwd, ".kumiko-public-exports-baseline.json");
    const pkgDir = join(cwd, "packages/framework");
    mkdirSync(join(pkgDir, "src"), { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@cosmicdrift/kumiko-framework",
        version: "1.5.0",
        exports: {
          "./auth": {
            types: "./src/auth/index.ts",
            default: "./src/auth/index.ts",
          },
        },
      }),
    );
    mkdirSync(join(pkgDir, "src/auth"), { recursive: true });
    writeFileSync(
      join(pkgDir, "src/auth/index.ts"),
      "export const login = () => 1;\nexport const logout = () => 2;\n",
    );
    writeFileSync(
      baselinePath,
      JSON.stringify({
        format: 1,
        generated: "2026-01-01",
        asOfVersion: "1.0.0",
        packages: { framework: { "./auth": ["login", "logout"] } },
      }),
    );
    const project = new Project({ useInMemoryFileSystem: false });
    return { cwd, project, baselinePath };
  }

  test("a renamed export without a matching breaking entry is a finding", () => {
    const { cwd, project, baselinePath } = buildFixture();
    try {
      // simulate rename: `logout` disappears
      writeFileSync(
        join(cwd, "packages/framework/src/auth/index.ts"),
        "export const login = () => 1;\n",
      );
      const result = evaluatePublicExportsChangelog({
        cwd,
        project,
        mode: "check",
        baselinePath,
      });
      expect(result.findings).toHaveLength(1);
      const finding = result.findings[0]!;
      expect(finding.names).toEqual(["logout"]);
      expect(finding.changelogPath).toBe("packages/framework/src/changes.json");
      expect(() => JSON.parse(finding.snippet)).not.toThrow();
      const parsed = JSON.parse(finding.snippet);
      expect(parsed.type).toBe("breaking");
      expect(parsed.version).toBe("1.5.0");
      expect(finding.cliHint).toContain(".changeset/");
      expect(finding.cliHint).toContain("feature: framework");
      expect(finding.cliHint).toContain("logout");
      expect(finding.cliHint).toContain("--write-baseline");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("a renamed export with a matching breaking entry is still a finding until the baseline is refrozen", () => {
    const { cwd, project, baselinePath } = buildFixture();
    try {
      writeFileSync(
        join(cwd, "packages/framework/src/auth/index.ts"),
        "export const login = () => 1;\n",
      );
      writeFileSync(
        join(cwd, "packages/framework/src/changes.json"),
        JSON.stringify([
          {
            version: "1.5.0",
            type: "breaking",
            title: "logout removed",
            migration: "use login() lifecycle instead",
          },
        ]),
      );
      const result = evaluatePublicExportsChangelog({
        cwd,
        project,
        mode: "check",
        baselinePath,
      });
      expect(result.findings).toHaveLength(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("no baseline file → missing status, not silently green", () => {
    const cwd = tmpDir("public-exports-nobaseline-");
    try {
      mkdirSync(join(cwd, "packages/framework/src/auth"), { recursive: true });
      writeFileSync(
        join(cwd, "packages/framework/package.json"),
        JSON.stringify({
          version: "1.0.0",
          exports: {
            "./auth": {
              types: "./src/auth/index.ts",
              default: "./src/auth/index.ts",
            },
          },
        }),
      );
      writeFileSync(join(cwd, "packages/framework/src/auth/index.ts"), "export const x = 1;\n");
      const project = new Project({ useInMemoryFileSystem: false });
      const baselinePath = join(cwd, ".kumiko-public-exports-baseline.json");
      const result = evaluatePublicExportsChangelog({
        cwd,
        project,
        mode: "check",
        baselinePath,
      });
      expect(result.baselineStatus).toBe("missing");
      expect(result.findings).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("check mode without a baseline file fails the CLI and points at --write-baseline", async () => {
    const cwd = tmpDir("public-exports-cli-nobaseline-");
    const errors: string[] = [];
    const originalError = console.error;
    try {
      writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "kumiko-framework" }));
      writeFileSync(join(cwd, "bun.lock"), "{}");
      writeFileSync(
        join(cwd, "kumiko.json"),
        JSON.stringify({
          kind: "framework",
          sourceRoots: ["packages/*/src"],
          testGlobs: ["packages/*/src/**/*.test.ts"],
        }),
      );
      writeFileSync(join(cwd, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
      const pkgDir = join(cwd, "packages/framework");
      mkdirSync(join(pkgDir, "src"), { recursive: true });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({ version: "1.0.0", exports: { ".": "./src/index.ts" } }),
      );
      writeFileSync(join(pkgDir, "src/index.ts"), "export const x = 1;\n");
      console.error = (msg: unknown) => {
        errors.push(String(msg));
      };
      expect(await runPublicExportsChangelogCli([], cwd)).toBe(1);
      expect(errors.join("\n")).toContain("--write-baseline");
    } finally {
      console.error = originalError;
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("--no-baseline mode always returns clean, regardless of drift", () => {
    const { cwd, project, baselinePath } = buildFixture();
    try {
      writeFileSync(
        join(cwd, "packages/framework/src/auth/index.ts"),
        "export const login = () => 1;\n",
      );
      const result = evaluatePublicExportsChangelog({
        cwd,
        project,
        mode: "no-baseline",
        baselinePath,
      });
      expect(result.baselineStatus).toBe("skipped");
      expect(result.findings).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("bundled-features package.json missing → skipped, not treated as all-exports-removed", () => {
    const { cwd, project, baselinePath } = buildFixture();
    try {
      // baseline references only framework, bundled-features is absent from
      // this checkout entirely — must not appear as a flood of findings.
      const result = evaluatePublicExportsChangelog({
        cwd,
        project,
        mode: "check",
        baselinePath,
      });
      expect(result.scans.map((s) => s.pkg)).toEqual(["framework"]);
      expect(result.findings).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// writeBaseline is the ratchet gate (mirrors check-complexity.ts): refreezing
// the baseline to drop a name requires a qualifying breaking changes.json
// entry against the OLD baseline's asOfVersion, or the write is refused.
describe("writeBaseline", () => {
  function buildRefreezeFixture(): {
    cwd: string;
    project: Project;
    baselinePath: string;
  } {
    const cwd = tmpDir("public-exports-writebaseline-");
    const baselinePath = join(cwd, ".kumiko-public-exports-baseline.json");
    const pkgDir = join(cwd, "packages/framework");
    mkdirSync(join(pkgDir, "src/auth"), { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@cosmicdrift/kumiko-framework",
        version: "1.5.0",
        exports: {
          "./auth": {
            types: "./src/auth/index.ts",
            default: "./src/auth/index.ts",
          },
        },
      }),
    );
    writeFileSync(join(pkgDir, "src/auth/index.ts"), "export const login = () => 1;\n");
    writeFileSync(
      baselinePath,
      JSON.stringify({
        format: 1,
        generated: "2026-01-01",
        asOfVersion: "1.0.0",
        packages: { framework: { "./auth": ["login", "logout"] } },
      }),
    );
    const project = new Project({ useInMemoryFileSystem: false });
    return { cwd, project, baselinePath };
  }

  function writeChangeset(
    cwd: string,
    type: string,
    feature: string,
    title = "Drop logout",
    migration = "use login",
  ): void {
    mkdirSync(join(cwd, ".changeset"), { recursive: true });
    writeFileSync(
      join(cwd, ".changeset/drop.md"),
      `---\n"@cosmicdrift/kumiko-framework": minor\n---\n\n${title}\n\n<!-- kumiko-changes\nfeature: ${feature}\ntype: ${type}\ntitle: ${title}\nmigration: ${migration}\n-->\n`,
    );
  }

  test("writeBaseline accepts a drop covered by an open breaking changeset of the owning feature", async () => {
    const { cwd, project, baselinePath } = buildRefreezeFixture();
    const parseChangesetChanges = await loadChangesetParser(REAL_FRAMEWORK_ROOT);
    try {
      writeChangeset(cwd, "breaking", "framework");
      const pending = pendingBreakingChangesIn(join(cwd, ".changeset"), parseChangesetChanges);
      expect(writeBaseline(cwd, project, baselinePath, pending)).toBe(0);
      const written = JSON.parse(readFileSync(baselinePath, "utf-8"));
      expect(written.packages.framework["./auth"]).toEqual(["login"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("writeBaseline refuses when the breaking changeset does not name the dropped export", async () => {
    const { cwd, project, baselinePath } = buildRefreezeFixture();
    const parseChangesetChanges = await loadChangesetParser(REAL_FRAMEWORK_ROOT);
    try {
      writeChangeset(cwd, "breaking", "framework", "Session handling changed", "log in again");
      const pending = pendingBreakingChangesIn(join(cwd, ".changeset"), parseChangesetChanges);
      expect(writeBaseline(cwd, project, baselinePath, pending)).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("writeBaseline accepts a breaking changeset that names the dropped export only in its migration", async () => {
    const { cwd, project, baselinePath } = buildRefreezeFixture();
    const parseChangesetChanges = await loadChangesetParser(REAL_FRAMEWORK_ROOT);
    try {
      writeChangeset(
        cwd,
        "breaking",
        "framework",
        "Session handling changed",
        "replace logout with login",
      );
      const pending = pendingBreakingChangesIn(join(cwd, ".changeset"), parseChangesetChanges);
      expect(writeBaseline(cwd, project, baselinePath, pending)).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("writeBaseline refuses when the open changeset is not breaking", async () => {
    const { cwd, project, baselinePath } = buildRefreezeFixture();
    const parseChangesetChanges = await loadChangesetParser(REAL_FRAMEWORK_ROOT);
    try {
      writeChangeset(cwd, "improvement", "framework");
      const pending = pendingBreakingChangesIn(join(cwd, ".changeset"), parseChangesetChanges);
      expect(pending.size).toBe(0);
      expect(writeBaseline(cwd, project, baselinePath, pending)).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("writeBaseline refuses when the breaking changeset belongs to another feature", async () => {
    const { cwd, project, baselinePath } = buildRefreezeFixture();
    const parseChangesetChanges = await loadChangesetParser(REAL_FRAMEWORK_ROOT);
    try {
      writeChangeset(cwd, "breaking", "audit");
      const pending = pendingBreakingChangesIn(join(cwd, ".changeset"), parseChangesetChanges);
      expect(writeBaseline(cwd, project, baselinePath, pending)).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("loadPendingBreakingChanges loads the real parser from the framework root", async () => {
    const pending = await loadPendingBreakingChanges(REAL_FRAMEWORK_ROOT);
    expect(pending.has("guards")).toBe(false);
  });

  test("loadPendingBreakingChanges fails loudly when the parser module is missing", async () => {
    const cwd = tmpDir("public-exports-noparser-");
    try {
      await expect(loadPendingBreakingChanges(cwd)).rejects.toThrow("changeset parser not found");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("writeBaseline refuses to drop a name when no qualifying breaking entry exists", () => {
    const { cwd, project, baselinePath } = buildRefreezeFixture();
    try {
      const exitCode = writeBaseline(cwd, project, baselinePath);
      expect(exitCode).toBe(1);
      const written = JSON.parse(readFileSync(baselinePath, "utf-8"));
      expect(written.packages.framework["./auth"]).toEqual(["login", "logout"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("writeBaseline succeeds and drops the name when a qualifying breaking entry exists", () => {
    const { cwd, project, baselinePath } = buildRefreezeFixture();
    try {
      writeFileSync(
        join(cwd, "packages/framework/src/changes.json"),
        JSON.stringify([
          {
            version: "1.0.0",
            type: "breaking",
            title: "logout removed",
            migration: "use login() lifecycle instead",
          },
        ]),
      );
      const exitCode = writeBaseline(cwd, project, baselinePath);
      expect(exitCode).toBe(0);
      const written = JSON.parse(readFileSync(baselinePath, "utf-8"));
      expect(written.packages.framework["./auth"]).toEqual(["login"]);
      expect(written.asOfVersion).toBe("1.5.0");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("writeBaseline preserves a package absent from this run's scans instead of dropping its baseline section", () => {
    // Old baseline knows about bundled-features, but this checkout has no
    // packages/bundled-features/package.json (partial/standalone checkout)
    // — its section must survive the refreeze untouched, not vanish.
    const cwd = tmpDir("public-exports-writebaseline-partial-");
    const baselinePath = join(cwd, ".kumiko-public-exports-baseline.json");
    try {
      const pkgDir = join(cwd, "packages/framework");
      mkdirSync(join(pkgDir, "src/auth"), { recursive: true });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "@cosmicdrift/kumiko-framework",
          version: "1.5.0",
          exports: {
            "./auth": {
              types: "./src/auth/index.ts",
              default: "./src/auth/index.ts",
            },
          },
        }),
      );
      writeFileSync(
        join(pkgDir, "src/auth/index.ts"),
        "export const login = () => 1;\nexport const logout = () => 2;\n",
      );
      writeFileSync(
        baselinePath,
        JSON.stringify({
          format: 1,
          generated: "2026-01-01",
          asOfVersion: "1.5.0",
          packages: {
            framework: { "./auth": ["login", "logout"] },
            "bundled-features": { "./audit": ["AuditLog"] },
          },
        }),
      );
      const project = new Project({ useInMemoryFileSystem: false });
      const exitCode = writeBaseline(cwd, project, baselinePath);
      expect(exitCode).toBe(0);
      const written = JSON.parse(readFileSync(baselinePath, "utf-8"));
      expect(written.packages["bundled-features"]).toEqual({
        "./audit": ["AuditLog"],
      });
      expect(written.packages.framework["./auth"]).toEqual(["login", "logout"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("writeBaseline with no prior baseline file performs a bootstrap freeze without requiring any changelog entry", () => {
    const cwd = tmpDir("public-exports-bootstrap-");
    try {
      const baselinePath = join(cwd, ".kumiko-public-exports-baseline.json");
      const pkgDir = join(cwd, "packages/framework");
      mkdirSync(join(pkgDir, "src/auth"), { recursive: true });
      writeFileSync(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "@cosmicdrift/kumiko-framework",
          version: "1.0.0",
          exports: {
            "./auth": {
              types: "./src/auth/index.ts",
              default: "./src/auth/index.ts",
            },
          },
        }),
      );
      writeFileSync(
        join(pkgDir, "src/auth/index.ts"),
        "export const login = () => 1;\nexport const logout = () => 2;\n",
      );
      const project = new Project({ useInMemoryFileSystem: false });
      const exitCode = writeBaseline(cwd, project, baselinePath);
      expect(exitCode).toBe(0);
      const written = JSON.parse(readFileSync(baselinePath, "utf-8"));
      expect(written.packages.framework["./auth"]).toEqual(["login", "logout"]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("runPublicExportsChangelogCli — consumer repo", () => {
  test("no framework root resolvable → hint and exit 0, nothing scanned", async () => {
    const cwd = tmpDir("public-exports-consumer-");
    try {
      expect(await runPublicExportsChangelogCli([], cwd)).toBe(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("unknown flag → exit 1", async () => {
    expect(await runPublicExportsChangelogCli(["--bogus"])).toBe(1);
  });
});

describe("evaluatePublicExportsChangelog — format drift + empty cwd", () => {
  function miniFramework(cwd: string): void {
    const pkgDir = join(cwd, "packages/framework");
    mkdirSync(join(pkgDir, "src/auth"), { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@cosmicdrift/kumiko-framework",
        version: "1.0.0",
        exports: {
          "./auth": {
            types: "./src/auth/index.ts",
            default: "./src/auth/index.ts",
          },
        },
      }),
    );
    writeFileSync(join(pkgDir, "src/auth/index.ts"), "export const login = () => 1;\n");
  }

  test("malformed baseline JSON → format drift, no throw", () => {
    const cwd = tmpDir("public-exports-badfmt-");
    try {
      miniFramework(cwd);
      writeFileSync(join(cwd, ".kumiko-public-exports-baseline.json"), "{not json");
      const result = evaluatePublicExportsChangelog({
        cwd,
        project: new Project({ useInMemoryFileSystem: false }),
        mode: "check",
        baselinePath: join(cwd, ".kumiko-public-exports-baseline.json"),
      });
      expect(result.baselineStatus).toBe("format-drift");
      expect(result.findings).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("empty cwd with no packages → findings (vacuity fail), not green", () => {
    const cwd = tmpDir("public-exports-empty-");
    try {
      writeFileSync(
        join(cwd, ".kumiko-public-exports-baseline.json"),
        JSON.stringify({ format: 1, generated: "2026-01-01", asOfVersion: "1.0.0", packages: {} }),
      );
      const result = evaluatePublicExportsChangelog({
        cwd,
        project: new Project({ useInMemoryFileSystem: false }),
        mode: "check",
        baselinePath: join(cwd, ".kumiko-public-exports-baseline.json"),
      });
      expect(result.scans).toEqual([]);
      expect(result.findings.length).toBeGreaterThan(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
