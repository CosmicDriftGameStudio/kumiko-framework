import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Project } from "ts-morph";
import { runGuards } from "../_lib/guard-kit";
import type { RepoRoot } from "../_lib/roots";
import type { RootScan } from "../_lib/scan-scope";
import { guard as noDirectFs } from "../guard-no-direct-fs";
import { guard as restrictedSymbols } from "../guard-restricted-symbols";
import { fixtureRoot } from "./parent-workspace-fixture";

const siblingSolon: RepoRoot = fixtureRoot("solon", "/private/tmp/claude-501/scratchpad/wt/solon", {
  kind: "app",
  sourceRoots: ["src"],
  testGlobs: ["src/**/*.{test,integration}.{ts,tsx}"],
});

const fsFile = join(siblingSolon.absPath, "src/rogue/feature.ts");
const restrictedFile = join(siblingSolon.absPath, "src/rogue/other.ts");

function projectWithFixtureFiles(): Project {
  const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });
  project.createSourceFile(
    fsFile,
    `
      import { readFileSync } from "node:fs";
      void readFileSync;
    `,
  );
  project.createSourceFile(
    restrictedFile,
    `
      import { getUnscopedAggregateStreamTenant } from "somewhere";
      void getUnscopedAggregateStreamTenant;
    `,
  );
  return project;
}

const scanBothFiles = (): readonly RootScan[] => [
  { root: siblingSolon, files: [fsFile, restrictedFile], sourceSurface: 2 },
];

describe("runGuards: roots reach guard.run() for a nonstandard sibling root", () => {
  test("a parent run with a sibling outside the standard layout keeps findings attributable", () => {
    const results = runGuards([noDirectFs, restrictedSymbols], projectWithFixtureFiles(), {
      roots: [siblingSolon],
      scan: scanBothFiles,
    });

    const fsResult = results.find((r) => r.name === noDirectFs.name);
    const restrictedResult = results.find((r) => r.name === restrictedSymbols.name);

    expect(fsResult?.error).toBeUndefined();
    expect(restrictedResult?.error).toBeUndefined();

    expect(fsResult?.outcome?.violations).toHaveLength(1);
    expect(fsResult?.outcome?.violations[0]?.file).toContain("wt/solon/src/rogue/feature.ts");

    expect(restrictedResult?.outcome?.violations).toHaveLength(1);
    expect(restrictedResult?.outcome?.violations[0]?.file).toBe("src/rogue/other.ts");
  });
});
