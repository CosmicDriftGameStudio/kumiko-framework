import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Project, type SourceFile } from "ts-morph";
import { resolveRepoRoots } from "../_lib/roots";
import { guard, isRepoAllowlisted } from "../guard-no-direct-fs";
import { fixtureRoot } from "./parent-workspace-fixture";

// Allowlist hits need a real RepoRoot — same pattern as guard-direct-fetch.
const frameworkRoot = resolveRepoRoots().find((r) => r.kind === "framework");
const enterpriseRoot = resolveRepoRoots().find((r) => r.name === "kumiko-enterprise");

function files(map: Record<string, string>): SourceFile[] {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });
  for (const [p, src] of Object.entries(map)) project.createSourceFile(p, src);
  return project.getSourceFiles();
}

describe("No-Direct-Fs Guard", () => {
  test("flags a node:fs import outside the allowlist", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/feature.ts": `
				import { readFileSync } from "node:fs";
				void readFileSync;
			`,
    });
    const { violations } = guard.run(sfs);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("node:fs");
  });

  test("flags the bare 'fs' specifier too", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/feature.ts": `
				import { readFileSync } from "fs";
				void readFileSync;
			`,
    });
    expect(guard.run(sfs).violations).toHaveLength(1);
  });

  test("flags fs/promises", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/feature.ts": `
				import { readFile } from "node:fs/promises";
				void readFile;
			`,
    });
    expect(guard.run(sfs).violations).toHaveLength(1);
  });

  test("flags a re-export of fs", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/wrapper.ts": `
				export { readFileSync } from "node:fs";
			`,
    });
    expect(guard.run(sfs).violations).toHaveLength(1);
  });

  test.skipIf(!frameworkRoot)("allows the guarded local-provider implementation", () => {
    const path = join(frameworkRoot!.absPath, "packages/framework/src/files/local-provider.ts");
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      useInMemoryFileSystem: true,
    });
    project.createSourceFile(
      path,
      `
				import { readFileSync } from "node:fs";
				void readFileSync;
			`,
    );
    expect(guard.run(project.getSourceFiles()).violations).toHaveLength(0);
  });

  test.skipIf(!frameworkRoot)("allows documented CLI/build tooling", () => {
    const path = join(frameworkRoot!.absPath, "packages/framework/src/schema-cli.ts");
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      useInMemoryFileSystem: true,
    });
    project.createSourceFile(
      path,
      `
				import { readFileSync } from "node:fs";
				void readFileSync;
			`,
    );
    expect(guard.run(project.getSourceFiles()).violations).toHaveLength(0);
  });

  test.skipIf(!frameworkRoot)(
    "allows kumiko-cli tooling but still flags the same relative path under framework",
    () => {
      const allowedPath = join(frameworkRoot!.absPath, "packages/cli/src/x.ts");
      const allowedProject = new Project({
        skipAddingFilesFromTsConfig: true,
        useInMemoryFileSystem: true,
      });
      allowedProject.createSourceFile(
        allowedPath,
        `
					import { readFileSync } from "node:fs";
					void readFileSync;
				`,
      );
      expect(guard.run(allowedProject.getSourceFiles()).violations).toHaveLength(0);

      const flaggedPath = join(frameworkRoot!.absPath, "packages/framework/src/x.ts");
      const flaggedProject = new Project({
        skipAddingFilesFromTsConfig: true,
        useInMemoryFileSystem: true,
      });
      flaggedProject.createSourceFile(
        flaggedPath,
        `
					import { readFileSync } from "node:fs";
					void readFileSync;
				`,
      );
      expect(guard.run(flaggedProject.getSourceFiles()).violations).toHaveLength(1);
    },
  );

  test.skipIf(!frameworkRoot || !enterpriseRoot)(
    "does not allow enterprise publish path under a non-enterprise root",
    () => {
      // Same relative path under framework must NOT inherit the enterprise allow.
      const path = join(frameworkRoot!.absPath, "packages/publish/src/build.ts");
      const project = new Project({
        skipAddingFilesFromTsConfig: true,
        useInMemoryFileSystem: true,
      });
      project.createSourceFile(
        path,
        `
					import { readFileSync } from "node:fs";
					void readFileSync;
				`,
      );
      expect(guard.run(project.getSourceFiles()).violations).toHaveLength(1);
    },
  );

  test("in-memory path with no matching root is not allowlistable for repo-scoped entries", () => {
    expect(isRepoAllowlisted(undefined, "packages/framework/src/schema-cli.ts")).toBe(false);
    expect(isRepoAllowlisted(undefined, "src/marketing/render-landing.ts")).toBe(false);
  });

  test("ignores unrelated imports", () => {
    const sfs = files({
      "packages/bundled-features/src/foo/feature.ts": `
				import { z } from "zod";
				void z;
			`,
    });
    expect(guard.run(sfs).violations).toHaveLength(0);
  });

  test("flags a dynamic import('fs')", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/feature.ts": `
				async function load() {
					const fs = await import("node:fs");
					return fs;
				}
				void load;
			`,
    });
    expect(guard.run(sfs).violations).toHaveLength(1);
  });

  test("flags a CommonJS require('fs') call", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/feature.ts": `
				const fs = require("fs");
				void fs;
			`,
    });
    expect(guard.run(sfs).violations).toHaveLength(1);
  });

  test("flags an 'import fs = require(...)' declaration", () => {
    const sfs = files({
      "packages/bundled-features/src/rogue/feature.ts": `
				import fs = require("node:fs");
				void fs;
			`,
    });
    expect(guard.run(sfs).violations).toHaveLength(1);
  });

  test("an ancestor 'tools/' segment above the repo root does not exclude the whole repo (path-normalization regression)", () => {
    const sfs = files({
      "tools/wt/packages/bundled-features/src/rogue/feature.ts": `
				import { readFileSync } from "node:fs";
				void readFileSync;
			`,
    });
    expect(guard.run(sfs).violations).toHaveLength(1);
  });
});

describe("No-Direct-Fs Guard — repo-local marker + baseline", () => {
  const BASELINE = ".kumiko-direct-fs-baseline.json";
  const REASON = "reads the build manifest at boot, fixed path";
  const marked = (reason: string) =>
    `// kumiko-lint-ignore direct-fs ${reason}\nimport { readFileSync } from "node:fs";\nvoid readFileSync;\n`;

  function withRepo(
    source: string,
    baseline: string | undefined,
    body: (ctx: { dir: string; run: () => ReturnType<typeof guard.run> }) => void,
    relFile = "src/boot.ts",
  ): void {
    const dir = mkdtempSync(join(tmpdir(), "direct-fs-guard-"));
    try {
      mkdirSync(join(dir, "src"), { recursive: true });
      if (baseline !== undefined) writeFileSync(join(dir, BASELINE), baseline);
      const root = fixtureRoot("app-repo", dir, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const project = new Project({
        skipAddingFilesFromTsConfig: true,
        useInMemoryFileSystem: true,
      });
      project.createSourceFile(join(dir, relFile), source);
      body({ dir, run: () => guard.run(project.getSourceFiles(), [root]) });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const baselineWith = (perFile: Record<string, number>) =>
    JSON.stringify({ format: 1, generated: "2026-01-01", total: 0, perFile });

  test("marker with a matching frozen (file, reason) passes", () => {
    withRepo(marked(REASON), baselineWith({ [`src/boot.ts::${REASON}`]: 1 }), ({ run }) => {
      expect(run().violations).toEqual([]);
    });
  });

  test("marker without a baseline file fails (fail-closed)", () => {
    withRepo(marked(REASON), undefined, ({ run }) => {
      const { violations } = run();
      expect(violations).toHaveLength(1);
      expect(violations[0]?.message).toContain("without a baseline file");
      expect(violations[0]?.line).toBe(1);
    });
  });

  test("marker whose reason changed vs the baseline fails", () => {
    withRepo(
      marked("a reworded reason"),
      baselineWith({ [`src/boot.ts::${REASON}`]: 1 }),
      ({ run }) => {
        expect(run().violations).toHaveLength(1);
      },
    );
  });

  test("an unreadable baseline file is a violation", () => {
    withRepo(marked(REASON), "{ not json", ({ run }) => {
      expect(run().violations[0]?.message).toContain("unreadable");
    });
  });

  test("a baseline with the wrong format is a violation", () => {
    withRepo(
      marked(REASON),
      JSON.stringify({ format: 99, perFile: { [`src/boot.ts::${REASON}`]: 1 } }),
      ({ run }) => {
        expect(run().violations[0]?.message).toContain("format drift");
      },
    );
  });

  test("more marker lines than frozen fails", () => {
    const twice = `${marked(REASON)}// kumiko-lint-ignore direct-fs ${REASON}\nimport { writeFileSync as w } from "node:fs";\nvoid w;\n`;
    withRepo(twice, baselineWith({ [`src/boot.ts::${REASON}`]: 1 }), ({ run }) => {
      expect(run().violations).toHaveLength(1);
    });
  });

  test("a bare tag without a reason does not suppress", () => {
    withRepo(
      `// kumiko-lint-ignore direct-fs\nimport { readFileSync } from "node:fs";\nvoid readFileSync;\n`,
      baselineWith({ "src/boot.ts::": 1 }),
      ({ run }) => {
        expect(run().violations).toHaveLength(1);
        expect(run().violations[0]?.message).toContain("outside allowlist");
      },
    );
  });

  test("the former repo:* marketing paths now fail in an app repo without a marker", () => {
    withRepo(
      `import { writeFileSync } from "node:fs";\nvoid writeFileSync;\n`,
      undefined,
      ({ run }) => {
        expect(run().violations).toHaveLength(1);
      },
      "src/marketing/render-landing.ts",
    );
  });

  test("writeBaseline freezes the current markers", () => {
    withRepo(marked(REASON), undefined, ({ dir }) => {
      const root = fixtureRoot("app-repo", dir, {
        kind: "app",
        sourceRoots: ["src"],
        testGlobs: ["src/**/*.test.ts"],
      });
      const project = new Project({
        skipAddingFilesFromTsConfig: true,
        useInMemoryFileSystem: true,
      });
      project.createSourceFile(join(dir, "src/boot.ts"), marked(REASON));
      guard.writeBaseline?.(project.getSourceFiles(), [root]);
      const written = JSON.parse(readFileSync(join(dir, BASELINE), "utf-8"));
      expect(written.perFile).toEqual({ [`src/boot.ts::${REASON}`]: 1 });
      expect(guard.run(project.getSourceFiles(), [root]).violations).toEqual([]);
    });
  });
});
