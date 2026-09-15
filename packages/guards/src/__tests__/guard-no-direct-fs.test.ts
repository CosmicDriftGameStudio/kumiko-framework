import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Project, type SourceFile } from "ts-morph";
import { resolveRepoRoots } from "../_lib/roots";
import { guard, isRepoAllowlisted } from "../guard-no-direct-fs";

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
    expect(isRepoAllowlisted(undefined, "src/marketing/render-landing.ts")).toBe(true);
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
